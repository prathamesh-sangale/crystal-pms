import { defineConfig, devices } from '@playwright/test';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // The suite writes to the database, so it starts from the fixed seed.
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Both halves of the stack, started from the repo root.
  webServer: [
    {
      command: 'npm run dev -w @pms/api',
      cwd: '../..',
      url: `${API}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: 'npm run dev -w @pms/web',
      cwd: '../..',
      url: WEB,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
    },
  ],

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: 'e2e/.auth/user.json',
      },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      // Phone-width screenshots. The responsive spec sets its own viewports,
      // so it does not need a second project to run in.
      name: 'phone',
      dependencies: ['setup'],
      use: {
        ...devices['Pixel 7'],
        storageState: 'e2e/.auth/user.json',
      },
      testMatch: /screenshots\.spec\.ts/,
    },
  ],
});
