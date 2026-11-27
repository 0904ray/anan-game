// 輸入：點擊、拖曳、滑鼠移動，以及建立對戰
import { randomTeam, isValidTeam, type GameState, type PlayerIdx, type Action, type Team } from '../engine';
import { ALLOW_SAME_CHAR_IN_TEAM, DEFAULT_TEAMS } from '../config';
import { LocalSession, HostSession, GuestSession, randomRoomCode, type SessionEvents } from '../net/session';
import { stage, toast } from './dom';
import { view, me, ui, session, myName, hoverDef, setSession, setView, setLastPlayed, setHoverDef, liveGame, artHidden, setArtHidden } from './state';
import { showSelect, closeSelect, isSelecting, setSelectStatus, handleSelectClick, handleSelectHover } from './select';
import { renderGame, cardInner } from './render';
import { renderLobby, readName } from './lobby';
import { enqueue, isBusy, fastForward } from './anim';
import { showCharSheet, showFullLog, showPile, showUnder, showMenu } from './popups';
import { setupZoom, zoomBlocksClick } from './zoom';

/** 文字訊息顯示在目前畫面合適的地方：大廳狀態列／選角狀態列／對戰中的提示 */
function notify(t: string) {
  if (view) toast(t);
  else if (isSelecting()) setSelectStatus(t);
  else { const el = stage.querySelector('.lobby .status'); if (el) el.textContent = t; }
}

export const events: SessionEvents = {
  onState(v: GameState, m: PlayerIdx) { closeSelect(); enqueue(v, m); },
  onStatus: notify,
  onError: notify,
  onNeedTeam() {
    setView(null, me);
    setLastPlayed(null);
    showSelect({ who: `${myName}・連線對戰`, online: true, onConfirm: team => session?.submitTeam(team) });
  },
};

// ---------------------------------------------------------------------
// 開始對戰：本機模式先選角再建立 Session
// ---------------------------------------------------------------------
function resetToSelect() { setSession(null); setView(null, me); setLastPlayed(null); }

function startBot() {
  resetToSelect();
  showSelect({ who: `${myName} 選角`, onConfirm: team => setSession(new LocalSession('bot', events, [myName, '電腦'], [team, randomTeam(Math.random, ALLOW_SAME_CHAR_IN_TEAM)])) });
}

function startHotseat() {
  resetToSelect();
  showSelect({
    who: `玩家一（${myName}）選角`,
    onConfirm: t1 => showSelect({ who: '玩家二 選角', onConfirm: t2 => setSession(new LocalSession('hotseat', events, [myName, '玩家二'], [t1, t2] as [Team, Team])) }),
  });
}

// =====================================================================
// 輸入
// =====================================================================
export function send(a: Action) { ui.picked = null; setHoverDef(null); session?.send(a); }

// =====================================================================
// 拖曳手牌：把手牌「拿起來」，拖到上方中央帶就打出（選牌時＝把牌丟進選擇）
// =====================================================================
interface DragState {
  cardEl: HTMLElement; unitId: string; uid: string; defId: string;
  startX: number; startY: number; x: number; y: number;
  gx: number; gy: number; k: number; frame: number;
  ghost: HTMLElement | null; bandEl: HTMLElement | null; band: DOMRect | null;
  slot: HTMLElement | null; slotHtml: string;
  mode: 'play' | 'pick';
  over: boolean;
}
let drag: DragState | null = null;
/** 剛拖曳完的時間：避免放開滑鼠後又觸發一次點擊 */
let dragEndedAt = 0;
/** 上一次點擊的手牌：用來自己判斷「點兩下」 */
const lastTap = { uid: '', at: 0 };

/** 同一張牌 320 毫秒內點第二下＝點兩下（第一次回傳 false，第二次回傳 true） */
function isDoubleTap(uid: string): boolean {
  const now = performance.now();
  if (lastTap.uid === uid && now - lastTap.at < 320) {
    lastTap.uid = ''; lastTap.at = 0;
    return true;
  }
  lastTap.uid = uid; lastTap.at = now;
  return false;
}

/** 效果要求選擇手牌時（例如棄牌）：點一下切換；拖曳進中央帶只加不減 */
function pickHandCard(uid: string, toggle: boolean) {
  const p = view?.prompt;
  if (p?.kind !== 'cards' || p.player !== me || !p.cardUids.includes(uid)) return;
  if (ui.selected.has(uid)) {
    if (!toggle) return;
    ui.selected.delete(uid);
  } else {
    if (p.max === 1) ui.selected.clear();
    if (ui.selected.size < p.max) ui.selected.add(uid);
  }
  renderGame();
}

function startDrag(d: DragState) {
  d.cardEl.classList.add('dragging');
  // 手牌上方的提示改成「拖到這裡」
  if (d.slot) { d.slotHtml = d.slot.innerHTML; d.slot.textContent = d.mode === 'pick' ? '拖到這裡選牌' : '拖到這裡出牌'; }
  const ghost = document.createElement('div');
  ghost.className = 'card drag-ghost';
  ghost.innerHTML = cardInner(d.defId);
  document.body.appendChild(ghost);
  d.ghost = ghost;
  const loop = () => {
    if (drag !== d || !d.ghost) return;
    // 彈性跟隨：牌微微落後手，再依落後量傾斜，像真的拿在手上
    d.gx += (d.x - d.gx) * 0.35;
    d.gy += (d.y - d.gy) * 0.35;
    const lag = Math.max(-14, Math.min(14, (d.x - d.gx) * 0.4));
    const rot = d.over ? lag * 0.4 : -3 + lag;
    const lift = d.over ? 1.16 : 1.06;
    d.ghost.style.transform = `translate3d(${d.gx}px, ${d.gy}px, 0) translate(-50%, -58%) rotate(${rot}deg) scale(${d.k * lift})`;
    d.frame = requestAnimationFrame(loop);
  };
  d.frame = requestAnimationFrame(loop);
}

function stopDrag(play: boolean) {
  const d = drag;
  if (!d) return;
  drag = null;
  cancelAnimationFrame(d.frame);
  d.bandEl?.classList.remove('drop-ready');
  d.cardEl.classList.remove('dragging');
  if (!d.ghost) return; // 還沒開始拖，交給 click 處理
  if (d.slot && d.slotHtml) d.slot.innerHTML = d.slotHtml;
  dragEndedAt = performance.now();
  if (play) {
    d.ghost.remove();
    if (d.mode === 'pick') pickHandCard(d.uid, false);
    else send({ type: 'play', unitId: d.unitId, cardUid: d.uid });
    return;
  }
  // 沒放到出牌區：順手滑回原位
  const r = d.cardEl.getBoundingClientRect();
  d.ghost.animate(
    [{ transform: d.ghost.style.transform, opacity: 1 },
     { transform: `translate3d(${r.left + r.width / 2}px, ${r.top + r.height / 2}px, 0) translate(-50%, -50%) rotate(0deg) scale(${d.k})`, opacity: 0 }],
    { duration: 190, easing: 'ease-out' },
  ).finished.then(() => d.ghost?.remove()).catch(() => d.ghost?.remove());
}

stage.addEventListener('pointerdown', e => {
  if (e.button !== 0 || drag || isBusy() || !view || view.winner !== null) return;
  const prompt = view.prompt;
  if (prompt && prompt.player !== me) return;
  const t = e.target as HTMLElement;
  let el: HTMLElement | null;
  let mode: 'play' | 'pick' = 'play';
  if (prompt) {
    // 效果要求選手牌（例如棄牌）：拖曳＝把牌丟進上方的選擇
    if (prompt.kind !== 'cards') return;
    el = t.closest('.hand [data-card].selectable') as HTMLElement | null;
    mode = 'pick';
  } else {
    if (view.active !== me) return;
    el = t.closest('.hand [data-card].playable') as HTMLElement | null;
  }
  if (!el) return;
  const bandEl = stage.querySelector<HTMLElement>('.band');
  drag = {
    cardEl: el, unitId: el.dataset.owner!, uid: el.dataset.card!, defId: el.dataset.previewCard!,
    startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, gx: e.clientX, gy: e.clientY,
    k: stage.getBoundingClientRect().width / 1920, frame: 0, ghost: null,
    bandEl, band: bandEl ? bandEl.getBoundingClientRect() : null,
    slot: bandEl?.querySelector<HTMLElement>('.show .slot') ?? null, slotHtml: '', mode, over: false,
  };
});

window.addEventListener('pointermove', e => {
  const d = drag;
  if (!d) return;
  if (!d.ghost) {
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 7) return;
    startDrag(d);
  }
  d.x = e.clientX; d.y = e.clientY;
  const b = d.band;
  const over = !!b && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  if (over !== d.over) {
    d.over = over;
    d.bandEl?.classList.toggle('drop-ready', over);
  }
  e.preventDefault();
}, { passive: false });

window.addEventListener('pointerup', () => stopDrag(drag?.over ?? false));
// 長按卡牌放大：放大的那一刻取消拖曳（還沒拖起來的牌不會被打出）
setupZoom(() => stopDrag(false));
window.addEventListener('pointercancel', () => stopDrag(false));

stage.addEventListener('click', e => {
  if (zoomBlocksClick()) return; // 剛長按放大／剛關掉放大：這一下不算點擊
  if (isBusy()) { fastForward(); return; } // 動畫播放中：點一下加速
  if (performance.now() - dragEndedAt < 300) return; // 剛拖曳完：不要又當成點擊
  const t = e.target as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => t.closest(sel) as T | null;

  const act = q('[data-act]');
  if (act) {
    const k = act.dataset.act;
    readName();
    if (k === 'bot') startBot();
    else if (k === 'hotseat') startHotseat();
    else if (k === 'host') { const code = randomRoomCode(); renderLobby('正在建立房間…', code); setSession(new HostSession(code, myName, events)); }
    else if (k === 'join') {
      const code = (stage.querySelector('#code') as HTMLInputElement).value.trim();
      if (!/^\d{6}$/.test(code)) { events.onError('房號是 6 位數字'); return; }
      setSession(new GuestSession(code, myName, events));
    } else if (k === 'rematch') { setLastPlayed(null); session?.rematch(); }
    else if (k === 'reselect') {
      if (session?.mode === 'bot') startBot();
      else if (session?.mode === 'hotseat') startHotseat();
      else session?.reselect();
    }
    else if (k === 'lobby') { closeSelect(); setLastPlayed(null); renderLobby(); }
    else if (k === 'toggle-art') { setArtHidden(!artHidden); renderLobby(); }
    else if (k === 'menu') showMenu();
    else if (k === 'fulllog') showFullLog();
    else if (k === 'close-popup') stage.querySelector('.popup-bg')?.remove();
    return;
  }
  if (handleSelectClick(t)) return;
  if (!view) return;
  const st = view;
  const myPrompt = st.prompt && st.prompt.player === me ? st.prompt : null;

  if (q('[data-end]')) { send({ type: 'endTurn' }); return; }
  const ab = q('[data-action]');
  if (ab) { send(JSON.parse(ab.dataset.action!)); return; }
  const ans = q('[data-answer]');
  if (ans) { send({ type: 'answer', value: JSON.parse(ans.dataset.answer!) }); return; }
  if (q('[data-answer-number]')) { send({ type: 'answer', value: ui.numberVal }); return; }
  if (q('[data-answer-cards]')) { send({ type: 'answer', value: [...ui.selected] }); return; }
  if (q('[data-play-picked]') && ui.picked) { send({ type: 'play', unitId: ui.picked.unitId, cardUid: ui.picked.uid }); return; }
  if (q('[data-cancel-pick]')) { ui.picked = null; renderGame(); return; }
  const underEl = q('[data-under]');
  if (underEl) { showUnder(underEl.dataset.under!); return; }
  const pile = q('[data-pile]');
  if (pile) { showPile(pile.dataset.pileUnit!, pile.dataset.pile as 'deck' | 'discard'); return; }

  const unitEl = q('[data-unit-click]');
  if (unitEl) {
    const id = unitEl.dataset.unitClick!;
    if (myPrompt?.kind === 'unit') { if (myPrompt.unitIds.includes(id)) send({ type: 'answer', value: id }); }
    else showCharSheet(id);
    return;
  }

  const cardEl = q('[data-card]');
  if (cardEl) {
    const uid = cardEl.dataset.card!;
    if (myPrompt?.kind === 'cards') {
      // 點兩下＝選取一次（不要第二下又把牌取消掉）
      if (!isDoubleTap(uid)) pickHandCard(uid, true);
      return;
    }
    if (cardEl.classList.contains('playable')) {
      // 點兩下＝直接出牌（320 毫秒內同一張牌點第二下）
      if (isDoubleTap(uid)) { send({ type: 'play', unitId: cardEl.dataset.owner!, cardUid: uid }); return; }
      ui.picked = ui.picked?.uid === uid ? null : { unitId: cardEl.dataset.owner!, uid };
      renderGame();
    } else if (!st.prompt && st.active === me) {
      const err = liveGame().checkAction(me, { type: 'play', unitId: cardEl.dataset.owner!, cardUid: uid });
      if (err) toast(err);
    }
  }
});

stage.addEventListener('input', e => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'numrange') {
    ui.numberVal = Number(t.value);
    const p = view?.prompt;
    const nv = document.getElementById('numval');
    if (nv && p?.kind === 'number') nv.textContent = `${p.label} ${ui.numberVal}`;
  }
});

stage.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).id === 'code' && e.key === 'Enter') (stage.querySelector('[data-act="join"]') as HTMLElement)?.click();
});

// 電腦：滑鼠移到手牌上，展示區先預覽那張牌（只換展示區的小卡，不整頁重畫）
stage.addEventListener('mouseover', e => {
  if (isSelecting()) { handleSelectHover(e.target as HTMLElement); return; }
  if (isBusy()) return;
  const c = (e.target as HTMLElement).closest('.hand [data-preview-card]') as HTMLElement | null;
  const slot = document.getElementById('showcard');
  if (!c || !slot || ui.picked || view?.prompt) return;
  const id = c.dataset.previewCard!;
  if (hoverDef === id) return;
  setHoverDef(id);
  slot.outerHTML = `<div class="showcard me" id="showcard">${cardInner(id)}</div>`;
});
stage.addEventListener('mousemove', e => {
  const el = (e.target as HTMLElement).closest('.tilt') as HTMLElement | null;
  stage.querySelectorAll<HTMLElement>('.tilt').forEach(x => { if (x !== el) { x.style.removeProperty('--rx'); x.style.removeProperty('--ry'); } });
  if (!el) return;
  const r = el.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  el.style.setProperty('--ry', `${(px - .5) * 22}deg`);
  el.style.setProperty('--rx', `${(.5 - py) * 18}deg`);
  el.style.setProperty('--sx', `${px * 100}%`);
  el.style.setProperty('--sy', `${py * 100}%`);
});

/**
 * 直接開始本機對戰（測試用網址 ?autostart=bot / hotseat）。
 * 想指定隊伍就加 &teams=ranis,savanna;saviel,granny（我方;對方，角色 id 用逗號分隔），沒寫或不合法就用 config 的 DEFAULT_TEAMS。
 */
export function startLocal(mode: 'bot' | 'hotseat') {
  setSession(new LocalSession(mode, events, [myName, mode === 'bot' ? '電腦' : '玩家二'], urlTeams() ?? DEFAULT_TEAMS));
}
function urlTeams(): [Team, Team] | null {
  const raw = new URLSearchParams(location.search).get('teams');
  const ts = raw?.split(';').map(t => t.split(',').map(x => x.trim()) as Team);
  if (!ts || ts.length !== 2 || !ts.every(t => t.length === 2 && isValidTeam(t, ALLOW_SAME_CHAR_IN_TEAM))) return null;
  return [ts[0], ts[1]];
}
