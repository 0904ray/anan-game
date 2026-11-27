import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION } from './src/config';

/**
 * 建置編號：把 src/ 和 public/ 的所有檔案內容算一個雜湊。
 * 程式或圖片有任何改動，編號就會變；什麼都沒改，重新打包也是同一個編號（docs/ 不會無故變動）。
 * 裝成 App 的玩家打開遊戲時，會拿自己的編號去比對網站上的 version.json，不一樣就提示更新。
 */
function buildId(): string {
  const h = createHash('sha1');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p).update(readFileSync(p));
    }
  };
  walk('src');
  walk('public');
  h.update(readFileSync('index.html'));
  return h.digest('hex').slice(0, 10);
}
const BUILD_ID = buildId();

/** 打包時多輸出一個 version.json（檢查更新用） */
const versionFile = (): Plugin => ({
  name: 'version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID, version: VERSION }) + '\n' });
  },
});

// 打包成單一 index.html（圖片放在旁邊的 assets 資料夾），雙擊就能開；也可以放上網站裝成 App（PWA）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: { host: true },
  build: { outDir: 'docs', emptyOutDir: true },
  test: { testTimeout: 60000 },
});
