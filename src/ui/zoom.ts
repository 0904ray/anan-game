// 長按卡牌放大：按住任何帶 data-zoom 的卡面（手牌、展示區、牌堆清單、選角牌組…）約半秒，
// 整張卡放大到佔滿畫面大部分；點畫面任何地方關掉。桌機也可以按滑鼠右鍵。
// 指著（桌機）或點（手機）卡上有底線的詞，左側才顯示那個詞的說明（一次一個）。
// 說明裡的詞條也能再點，換成那個詞的說明。
// 放大層掛在 <body> 上（不在 #stage 裡），所以對手出牌、畫面重畫時不會被洗掉。
import { CARD_DEFS, findKeyword } from '../engine';
import { cardInner, richText, keywordsIn, kwSpan, themeOf } from './render';

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
  const d = CARD_DEFS[defId];
  const hasKw = keywordsIn(d.text).length > 0 || !!d.discardText || !!d.drawText;
  el.innerHTML = `${hasKw ? `<div class="zoom-info empty" style="--theme:${themeOf(d.charId)}"><div class="zi-hint">指著或點卡上有底線的詞<br>這裡會顯示說明</div></div>` : ''}
    <div class="zoom-cardbox"><div class="card zoomcard">${cardInner(defId, cost)}</div></div>
    <div class="zoom-hint">點空白處關閉</div>`;
  // 只有「在放大層上按下去」的那一下才算關閉，長按放開時手機補發的 click 不算
  let armed = false;
  el.addEventListener('pointerdown', e => { armed = true; e.stopPropagation(); });
  // 滑鼠指著卡上的詞就顯示；說明區裡的詞要點才換（不然滑鼠移過去時說明會一直跳）
  el.addEventListener('pointerover', e => {
    const w = kwOf(e);
    if (w && e.pointerType === 'mouse' && (e.target as HTMLElement).closest('.zoomcard')) focusWord(el, w);
  });
  el.addEventListener('click', e => {
    e.stopPropagation();
    const w = kwOf(e);
    if (w) { focusWord(el, w); return; }
    if ((e.target as HTMLElement).closest('.zoom-info')) return; // 在說明區裡點（或捲動）不關閉
    if (armed) closeZoom();
  });
  document.body.appendChild(el);
  layer = el;
}

function entryHtml(word: string): string {
  const k = findKeyword(word);
  if (!k) return '';
  return `<div class="zi-entry" data-kw-entry="${k.name}"><div class="zi-name">${kwSpan(k.name)}${k.wip ? '<span class="zi-wip">尚未實作</span>' : ''}</div><div class="zi-text">${richText(k.text, k.name)}</div></div>`;
}
function kwOf(e: Event): string | null {
  return ((e.target as HTMLElement | null)?.closest?.('[data-kw]') as HTMLElement | null)?.dataset.kw ?? null;
}
/** 在左側顯示某個詞條的說明（一次一個） */
function focusWord(el: HTMLElement, word: string) {
  const info = el.querySelector<HTMLElement>('.zoom-info');
  if (!info) return;
  const html = entryHtml(word);
  if (!html) return;
  info.classList.remove('empty');
  info.innerHTML = html;
  info.scrollTop = 0;
  el.querySelectorAll('.zoomcard .kw-def.on').forEach(x => x.classList.remove('on'));
  el.querySelectorAll<HTMLElement>('.zoomcard [data-kw]').forEach(x => { if (x.dataset.kw === word) x.classList.add('on'); });
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
