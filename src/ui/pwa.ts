// PWA：裝成 App、離線可玩、打開時檢查更新
// - public/sw.js 負責離線快取；public/manifest.webmanifest 是 App 的名稱、圖示、橫向全螢幕設定
// - 打包時 vite.config.ts 會輸出 version.json（建置編號），這裡拿它和自己的 __BUILD_ID__ 比對
import { installPrompt, setInstallPrompt, setUpdateReady, updateReady } from './state';

/** 正式網址才啟用（開發伺服器、直接雙擊 index.html、嵌在預覽框裡都跳過） */
const enabled = () => import.meta.env.PROD && (location.protocol === 'https:' || location.hostname === 'localhost') && 'serviceWorker' in navigator && window.self === window.top;

/** 已經是裝好的 App（從主畫面圖示打開） */
export const isInstalled = () =>
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true;

/** iPhone／iPad 的 Safari：沒有安裝按鈕，要自己「分享 → 加入主畫面」 */
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** onChange：更新狀態或可安裝狀態改變時（重畫大廳用） */
export function setupPwa(onChange: () => void) {
  if (!enabled()) return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* 不支援就當一般網頁 */ });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // 不要讓瀏覽器自己跳，改成大廳的按鈕
    setInstallPrompt(e as any);
    onChange();
  });
  window.addEventListener('appinstalled', () => { setInstallPrompt(null); onChange(); });
  checkUpdate(onChange);
}

/** 讀網站上的 version.json（不用快取），建置編號和自己不一樣就提示更新；沒網路就算了 */
async function checkUpdate(onChange: () => void) {
  try {
    const r = await fetch('./version.json', { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json() as { build: string; version: string };
    if (v.build && v.build !== __BUILD_ID__) { setUpdateReady(v.version || '新版本'); onChange(); }
  } catch { /* 離線 */ }
}

/** 玩家按「更新」：請背景程式清掉舊快取、抓新版，然後重新整理 */
export function applyUpdate() {
  if (!updateReady) return;
  const reload = () => location.reload();
  const sw = navigator.serviceWorker?.controller;
  if (!sw) { reload(); return; }
  navigator.serviceWorker.addEventListener('message', e => { if (e.data === 'updated') reload(); });
  sw.postMessage('update');
  setTimeout(reload, 8000); // 保險：背景程式沒回應也重新整理
}

/** 玩家按「安裝到裝置」 */
export async function promptInstall() {
  const p = installPrompt;
  if (!p) return;
  setInstallPrompt(null);
  await p.prompt().catch(() => { /* 使用者取消 */ });
}
