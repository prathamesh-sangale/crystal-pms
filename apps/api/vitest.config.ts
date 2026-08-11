import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      // A separate file from dev.db, reset before every run.
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret-long-enough-to-pass-validation',
      WEB_ORIGIN: 'http://localhost:5173',
      PORT: '4999',
    },
    globalSetup: ['./src/__tests__/globalSetup.ts'],
    // The suite shares one SQLite file, so files must not race each other.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
