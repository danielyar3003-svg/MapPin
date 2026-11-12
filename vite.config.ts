import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
