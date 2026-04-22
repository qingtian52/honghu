import { defineConfig } from 'vite'

export default defineConfig({
  // 指定项目根目录为 public/，这样 Vite 会去 public/ 里找 index.html
  root: 'public',
  base: './',
  build: {
    // 打包输出到项目根目录的 dist/ 文件夹
    outDir: '../dist',
    // 清空打包目录
    emptyOutDir: true
  }
})