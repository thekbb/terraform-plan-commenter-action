import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.js'],
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      provider: 'v8',
      include: ['scripts/**/*.cjs', 'scripts/**/*.js'],
      exclude: [
        'scripts/**/*.test.js',
        'scripts/format-comment.js', // GitHub API glue code, not unit-testable
      ],
    },
  },
});
