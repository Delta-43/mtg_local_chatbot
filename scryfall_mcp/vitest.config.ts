import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        'vitest.config.ts',
        'test-artifact-fix.js',
      ],
      thresholds: {
        // Global gates only for now. Several low-coverage areas are already tracked
        // as follow-up engineering work, and a per-file gate would currently add
        // noise rather than meaningful confidence.
        statements: 60,
        branches: 60,
        functions: 65,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
