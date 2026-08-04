import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    middlewareMode: false,
  },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
