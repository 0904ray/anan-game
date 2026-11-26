import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 打包成單一 index.html（圖片放在旁邊的 assets 資料夾），雙擊就能開
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  server: { host: true },
  build: { outDir: 'docs', emptyOutDir: true },
});
