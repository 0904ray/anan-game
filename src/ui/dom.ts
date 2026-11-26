// 畫面共用：舞台元素、圖片路徑、小工具
export const ASSET = {
  char: (id: string) => `assets/chars/${id}.png`,
  card: (id: string) => `assets/cards/${id}.png`,
  table: 'assets/bg/table.png',
  lobby: 'assets/bg/lobby.png',
  /** 通用卡背（角色沒有專屬卡背時使用） */
  back: 'assets/ui/card-back.png',
  /** 角色專屬卡面底框：該角色所有卡牌共用 */
  frame: (charId: string) => `assets/frames/${charId}.png`,
  /** 角色專屬卡背：該角色的牌組、對手手牌、抽牌動畫 */
  backOf: (charId: string) => `assets/backs/${charId}.png`,
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

