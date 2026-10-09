import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Source only. Compiled output must never be collected — it would run
    // every test twice, the second time against a stale build.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-long-enough-to-pass-validation',
      WEB_ORIGIN: 'http://localhost:5173',
      PORT: '4999',
    },
    testTimeout: 20_000,
  },
});
