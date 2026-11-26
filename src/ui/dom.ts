// 畫面共用：舞台元素、圖片路徑、小工具

/**
 * 圖片路徑一律寫「不含副檔名」的基本路徑；實際檔案（.webp 優先、其次 .png）由 ui/preload.ts 在開場時找好。
 * 找不到的圖回傳一個一定載入失敗的網址，畫面會自動露出佔位圖。
 */
const resolved = new Map<string, string | null>();
const MISSING = 'data:,';
export function setResolvedAsset(base: string, url: string | null) { resolved.set(base, url); }
const url = (base: string) => (resolved.has(base) ? resolved.get(base) ?? MISSING : `${base}.webp`);

export const ASSET_BASE = {
  char: (id: string) => `assets/chars/${id}`,
  card: (id: string) => `assets/cards/${id}`,
  frame: (charId: string) => `assets/frames/${charId}`,
  backOf: (charId: string) => `assets/backs/${charId}`,
  table: 'assets/bg/table',
  lobby: 'assets/bg/lobby',
  back: 'assets/ui/card-back',
};

export const ASSET = {
  char: (id: string) => url(ASSET_BASE.char(id)),
  card: (id: string) => url(ASSET_BASE.card(id)),
  get table() { return url(ASSET_BASE.table); },
  get lobby() { return url(ASSET_BASE.lobby); },
  /** 通用卡背（角色沒有專屬卡背時使用） */
  get back() { return url(ASSET_BASE.back); },
  /** 角色專屬卡面底框：該角色所有卡牌共用 */
  frame: (charId: string) => url(ASSET_BASE.frame(charId)),
  /** 角色專屬卡背：該角色的牌組、對手手牌、抽牌動畫 */
  backOf: (charId: string) => url(ASSET_BASE.backOf(charId)),
};

export const stage = document.getElementById('stage')!;
export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** 由文字算出固定色相（沒有圖時的佔位色） */
export const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

/** 16:9 等比縮放，並讓載入失敗的圖片隱藏、露出佔位圖 */
export function setupStage() {
  document.addEventListener('error', e => { const t = e.target as HTMLElement; if (t?.tagName === 'IMG') t.classList.add('missing'); }, true);
  const fit = () => { stage.style.transform = `scale(${Math.min(window.innerWidth / 1920, window.innerHeight / 1080)})`; };
  window.addEventListener('resize', fit);
  fit();
  document.getElementById('rotate-ok')?.addEventListener('click', () => document.body.classList.add('rotate-ok'));
}

let toastTimer: any;
export function toast(t: string) {
  stage.querySelectorAll('.toast').forEach(x => x.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = t;
  stage.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2300);
}

