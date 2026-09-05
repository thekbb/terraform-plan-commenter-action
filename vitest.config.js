import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.{js,ts}'],
    coverage: {
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
      ],
    },
  },
});
