import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    environment: 'node',
    testTimeout: 15_000,
    setupFiles: ['./test/setup-pricing-defaults.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      thresholds: {
        lines: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
