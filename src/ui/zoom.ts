// 長按卡牌放大：按住任何帶 data-zoom 的卡面（手牌、展示區、牌堆清單、選角牌組…）約半秒，
// 整張卡放大到佔滿畫面大部分；點畫面任何地方關掉。桌機也可以按滑鼠右鍵。
// 放大層掛在 <body> 上（不在 #stage 裡），所以對手出牌、畫面重畫時不會被洗掉。
import { CARD_DEFS } from '../engine';
import { cardInner } from './render';

const HOLD_MS = 420;   // 按多久算長按
const MOVE_PX = 7;     // 手指移動超過這個距離＝在拖曳，不算長按（和拖曳出牌的門檻一樣）

let layer: HTMLElement | null = null;
let closedAt = 0;
let press: { x: number; y: number; timer: number; id: number } | null = null;
let onOpen: () => void = () => {};

/** 放大層開著，或剛關掉／剛打開（避免同一下點擊又觸發底下的操作） */
export function zoomBlocksClick(): boolean {
  return !!layer || performance.now() - closedAt < 250;
}

export function closeZoom() {
  if (!layer) return;
  layer.remove();
  layer = null;
  closedAt = performance.now();
}

export function openZoom(defId: string, cost?: number) {
  if (!CARD_DEFS[defId]) return;
  closeZoom();
  onOpen();
  const el = document.createElement('div');
  el.className = 'zoom-bg';
  const k = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  el.style.setProperty('--k', String(k));
  el.innerHTML = `<div class="card zoomcard">${cardInner(defId, cost)}</div><div class="zoom-hint">點任意處關閉</div>`;
  // 只有「在放大層上按下去」的那一下才算關閉，長按放開時手機補發的 click 不算
  let armed = false;
  el.addEventListener('pointerdown', e => { armed = true; e.stopPropagation(); });
  el.addEventListener('click', e => { e.stopPropagation(); if (armed) closeZoom(); });
  el.addEventListener('contextmenu', e => { e.preventDefault(); closeZoom(); });
  document.body.appendChild(el);
  layer = el;
}

function target(e: Event): HTMLElement | null {
  return (e.target as HTMLElement | null)?.closest?.('[data-zoom]') as HTMLElement | null;
}
function fire(el: HTMLElement) {
  const cost = el.dataset.zoomCost;
  openZoom(el.dataset.zoom!, cost !== undefined ? Number(cost) : undefined);
}
function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}

/** 安裝長按偵測。open：放大時要做的事（例如取消拖曳） */
export function setupZoom(open: () => void) {
  onOpen = open;
  document.addEventListener('pointerdown', e => {
    cancelPress();
    if (layer || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = target(e);
    if (!el) return;
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, timer: window.setTimeout(() => { press = null; fire(el); }, HOLD_MS) };
  }, true);
  document.addEventListener('pointermove', e => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= MOVE_PX) cancelPress();
  }, true);
  document.addEventListener('pointerup', cancelPress, true);
  document.addEventListener('pointercancel', cancelPress, true);
  // 右鍵（桌機）／系統長按選單（手機）：卡牌上改成放大
  document.addEventListener('contextmenu', e => {
    const el = target(e);
    if (!el) return;
    e.preventDefault();
    cancelPress();
    if (!layer) fire(el);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeZoom(); });
}
