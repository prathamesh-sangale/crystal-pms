import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Source only. Compiled output must never be collected — it would run
    // every test twice, the second time against a stale build.
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
