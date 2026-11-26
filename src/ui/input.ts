// 輸入：點擊、拖曳、滑鼠移動，以及建立對戰
import { randomTeam, type GameState, type PlayerIdx, type Action, type Team } from '../engine';
import { ALLOW_SAME_CHAR_IN_TEAM, DEFAULT_TEAMS } from '../config';
import { LocalSession, HostSession, GuestSession, randomRoomCode, type SessionEvents } from '../net/session';
import { stage, toast } from './dom';
import { view, me, ui, session, myName, hoverDef, setSession, setView, setLastPlayed, setHoverDef, liveGame } from './state';
import { showSelect, closeSelect, isSelecting, setSelectStatus, handleSelectClick, handleSelectHover } from './select';
import { renderGame, cardInner } from './render';
import { renderLobby, readName } from './lobby';
import { enqueue, isBusy, fastForward } from './anim';
import { showCharSheet, showFullLog, showPile, showUnder, showMenu } from './popups';

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

stage.addEventListener('click', e => {
  if (isBusy()) { fastForward(); return; } // 動畫播放中：點一下加速
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
      if (!myPrompt.cardUids.includes(uid)) return;
      if (ui.selected.has(uid)) ui.selected.delete(uid);
      else {
        if (myPrompt.max === 1) ui.selected.clear();
        if (ui.selected.size < myPrompt.max) ui.selected.add(uid);
      }
      renderGame();
      return;
    }
    if (cardEl.classList.contains('playable')) {
      ui.picked = ui.picked?.uid === uid ? null : { unitId: cardEl.dataset.owner!, uid };
      renderGame();
    } else if (!st.prompt && st.active === me) {
      const err = liveGame().checkAction(me, { type: 'play', unitId: cardEl.dataset.owner!, cardUid: uid });
      if (err) toast(err);
    }
  }
});

stage.addEventListener('dblclick', e => {
  const cardEl = (e.target as HTMLElement).closest('[data-card].playable') as HTMLElement | null;
  if (cardEl) send({ type: 'play', unitId: cardEl.dataset.owner!, cardUid: cardEl.dataset.card! });
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

/** 直接開始本機對戰（測試用網址 ?autostart=bot / hotseat） */
export function startLocal(mode: 'bot' | 'hotseat') {
  setSession(new LocalSession(mode, events, [myName, mode === 'bot' ? '電腦' : '玩家二'], DEFAULT_TEAMS));
}
