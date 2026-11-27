// 離線快取（PWA）：裝成 App 後沒網路也能開，打開時由畫面去比對 version.json 決定要不要更新。
// - 遊戲本體（index.html）和圖片：先用快取（開得快、離線可用），沒有才上網抓並存起來
// - version.json：一律上網抓（檢查更新用），不進快取
// - 玩家按「更新」時，畫面送 'update' 訊息：清掉整個快取，重新抓遊戲本體，畫面再重新整理
const CACHE = 'ethereal-arena';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // PeerJS 等外部連線不管
  if (url.pathname.endsWith('/version.json')) return; // 檢查更新：一律走網路
  // 遊戲本體：不管網址帶什麼參數（例如 ?autostart=bot）都用同一份
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/index.html');
  const key = isPage ? new Request(new URL('./', self.registration.scope)) : req;
  e.respondWith(
    caches.open(CACHE).then(async c => {
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(key, res.clone());
      return res;
    }),
  );
});

self.addEventListener('message', e => {
  if (e.data !== 'update') return;
  e.waitUntil(
    caches.delete(CACHE)
      .then(() => caches.open(CACHE))
      .then(c => Promise.all(SHELL.map(p => fetch(p, { cache: 'reload' }).then(r => (r.ok ? c.put(p, r) : null)))))
      .then(() => e.source && e.source.postMessage('updated')),
  );
});
