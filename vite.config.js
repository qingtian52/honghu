import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173, // 与你之前的端口保持一致
    open: true
  },
  build: {
    outDir: 'dist'
  }
});