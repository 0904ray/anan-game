import { CARD_DEFS, CHAR_DEFS, type GameState, type PlayerIdx, type UnitSnap, type FxEvent } from '../engine';
import { stage } from './dom';
import { view, me, lastFxSeq, setView, setLastFxSeq, setLastPlayed, rel, liveGame } from './state';
import { renderGame, mergeSnap, unitHtml, pilesHtml, miniPilesHtml, bandHtml, cardInner, backHtml } from './render';
import { playSfx } from './audio';

// =====================================================================
// 動畫佇列：每次收到新畫面，照遊戲事件的順序一個一個播
//  抽牌：牌從牌組飛進手牌　出牌：飛到中間放大展示 → 縮進展示區 → 結算完進棄牌區
//  棄牌：飛進棄牌區　吞噬：飛進葛蘭妮的吞噬牌堆　攻擊：衝向目標　傷害／回血／TP／狀態：跳數字
// =====================================================================
let busy = false;
let speed = 1; // 點畫面可加速
export const isBusy = () => busy;
/** 播放中點畫面：加速播完 */
export function fastForward() { speed = 0.15; }
const pending: { v: GameState; m: PlayerIdx }[] = [];

export function enqueue(v: GameState, m: PlayerIdx) {
  pending.push({ v, m });
  if (!busy) void pump();
}

async function pump() {
  busy = true;
  stage.classList.add('busy');
  try {
    while (pending.length) {
      const { v, m } = pending.shift()!;
      speed = pending.length > 2 ? 0.4 : 1; // 積太多就播快一點
      await present(v, m);
    }
  } finally {
    busy = false;
    stage.classList.remove('busy');
    renderGame();
  }
}

/** 從畫面上的遊戲狀態做出「動作之前」的快照 */
function snapsOf(st: GameState): UnitSnap[] {
  return [...st.players[0].units, ...st.players[1].units].map(u => ({
    id: u.id, hp: u.hp, tp: u.tp, ap: u.ap, tHp: u.tHp, life: u.life, critical: u.critical, spBonus: u.spBonus,
    dmgReduce: u.dmgReduce, noWound: u.noWound, noTpLoss: u.noTpLoss, halfTpNext: u.halfTpNext,
    counters: { ...u.counters }, tpMaxDown: u.tpMaxDown, under: u.under.length, deck: u.deck.length, discard: u.discard.length,
    discardTop: u.discard.length ? u.discard[u.discard.length - 1].defId : null, hand: u.hand.length,
  }));
}

interface Rect { x: number; y: number; w: number; h: number }
function rectOf(el: Element | null): Rect | null {
  if (!el) return null;
  const sr = stage.getBoundingClientRect();
  const k = sr.width / 1920;
  const r = el.getBoundingClientRect();
  return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k };
}
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms * speed));

async function present(v: GameState, m: PlayerIdx) {
  const prev = view;
  const prevMe = me;
  const fresh = v.fxSeq !== lastFxSeq;
  setLastFxSeq(v.fxSeq);
  const canAnim = fresh && prev && prev.gameId === v.gameId && prevMe === m && v.fx.length > 0;
  setView(v, m);
  if (!canAnim) {
    if (!prev || prev.gameId !== v.gameId) setLastPlayed(null);
    for (const e of v.fx) if (e.t === 'play') setLastPlayed({ defId: e.defId, by: liveGame().unit(e.unitId).name, side: liveGame().unit(e.unitId).owner });
    renderGame({ snaps: snapsOf(v), hidden: new Set() });
    const turn = v.fx.find(e => e.t === 'turn');
    if (turn && turn.t === 'turn') { banner(turn.player); await sleep(900); }
    return;
  }

  // 1. 記下舊畫面我方手牌的位置
  const oldRects = new Map<string, Rect>();
  stage.querySelectorAll<HTMLElement>('.hand [data-card]').forEach(el => {
    const r = rectOf(el);
    if (r) oldRects.set(el.dataset.card!, r);
  });
  const oldHand = new Map<string, string>(); // uid → defId
  for (const u of prev!.players[m].units) for (const c of u.hand) oldHand.set(c.uid, c.defId);

  // 2. 畫出新畫面，但數值先停在動作之前、這批抽到的牌先藏起來
  const drawn = new Set(v.fx.filter(e => e.t === 'draw').map(e => (e as any).uid as string));
  renderGame({ snaps: snapsOf(prev!), hidden: drawn });
  const layer = stage.querySelector('.fxlayer') as HTMLElement;

  // 3. 離開手牌的牌先留一張「替身」在原位，等輪到它的事件再飛走
  const ghosts = new Map<string, HTMLElement>();
  const newHand = new Set<string>();
  for (const u of v.players[m].units) for (const c of u.hand) newHand.add(c.uid);
  for (const [uid, r] of oldRects) {
    if (newHand.has(uid)) continue;
    ghosts.set(uid, makeFly(layer, oldHand.get(uid)!, r));
  }
  // 留在手上的牌從舊位置滑到新位置
  stage.querySelectorAll<HTMLElement>('.hand [data-card]').forEach(el => {
    const old = oldRects.get(el.dataset.card!);
    const now = rectOf(el);
    if (!old || !now) return;
    const dx = old.x - now.x, dy = old.y - now.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 260 * speed, easing: 'ease-out' });
  });

  // 4. 照順序播事件
  for (const e of v.fx) {
    try { await playEvent(e, layer, ghosts); } catch (err) { console.error(err); }
  }
  ghosts.forEach(gh => gh.remove());
}

// ---------- 位置 ----------
const isMine = (unitId: string) => Number(unitId[1]) === me;
const q1 = (sel: string) => stage.querySelector(sel);
const deckRect = (id: string) => rectOf(isMine(id) ? q1(`[data-piles="${id}"] .pile.deck`) : q1(`[data-piles="${id}"] .mp:first-child > div`));
const discardRect = (id: string) => rectOf(isMine(id) ? q1(`[data-piles="${id}"] .pile.discard`) : q1(`[data-piles="${id}"] .mp:last-child > div`));
const portraitRect = (id: string) => rectOf(q1(`.unit[data-unit="${id}"] .portrait`));
const underRect = (id: string) => rectOf(q1(`[data-under="${id}"]`)) ?? portraitRect(id);
const showRect = () => rectOf(q1('#showcard'));
const BIG: Rect = { x: 795, y: 70, w: 330, h: 462 };
const handSpot = (id: string) => {
  const r = rectOf(q1(`.hand[data-hand="${id}"]`));
  return r ? { x: r.x + 270, y: r.y + 52, w: 230, h: 322 } : null;
};

// ---------- 飛行的牌 ----------
const CW = 230, CH = 322;
/** 卡背要用哪個角色的：看這張牌從哪個角色的牌堆來 */
const charOf = (unitId: string) => liveGame().unit(unitId).charId;

function makeFly(layer: HTMLElement, defId: string | null, r: Rect, backChar?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'fly';
  el.innerHTML = defId && CARD_DEFS[defId] ? `<div class="card static">${cardInner(defId)}</div>` : `<div class="flyback">${backHtml(backChar ?? '')}</div>`;
  el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${r.w / CW})`;
  layer.appendChild(el);
  return el;
}
function tf(r: Rect, rot = 0) { return `translate(${r.x}px, ${r.y}px) scale(${r.w / CW}, ${r.h / CH}) rotate(${rot}deg)`; }
async function flyTo(el: HTMLElement, from: Rect, to: Rect, ms: number, opt: { fade?: boolean; arc?: number } = {}) {
  const mid: Rect = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - (opt.arc ?? 40), w: (from.w + to.w) / 2, h: (from.h + to.h) / 2 };
  const a = el.animate(
    [{ transform: tf(from), opacity: 1 }, { transform: tf(mid, 4), opacity: 1, offset: 0.5 }, { transform: tf(to), opacity: opt.fade ? 0 : 1 }],
    { duration: ms * speed, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' },
  );
  await a.finished.catch(() => {});
}
function rectFromEl(el: HTMLElement): Rect {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)/.exec(el.style.transform);
  return m ? { x: +m[1], y: +m[2], w: +m[3] * CW, h: +m[3] * CH } : { x: 0, y: 0, w: CW, h: CH };
}

// ---------- 數值更新 ----------
function applySnap(snaps: UnitSnap[]) {
  const g = liveGame();
  for (const p of view!.players) {
    for (const u of p.units) {
      const shown = mergeSnap(u, snaps);
      const side = u.owner === me ? 'mine' : 'theirs';
      const el = q1(`.unit[data-unit="${u.id}"]`) as HTMLElement | null;
      if (el) {
        const oldW = (el.querySelector('.hpbar .fill') as HTMLElement | null)?.style.width;
        const tmp = document.createElement('div');
        tmp.innerHTML = unitHtml(g, shown, side, [], false);
        const nu = tmp.firstElementChild as HTMLElement;
        const fill = nu.querySelector('.hpbar .fill') as HTMLElement | null;
        const newW = fill?.style.width;
        if (fill && oldW && oldW !== newW) { fill.style.width = oldW; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = newW!; })); }
        el.replaceWith(nu);
      }
      const pe = q1(`[data-piles="${u.id}"]`);
      if (pe) {
        const tmp = document.createElement('div');
        tmp.innerHTML = side === 'mine' ? pilesHtml(shown) : miniPilesHtml(shown);
        pe.replaceWith(tmp.firstElementChild!);
      }
      const lab = q1(`.hand[data-hand="${u.id}"] .label`);
      const sn = snaps.find(x => x.id === u.id);
      if (lab && sn) lab.textContent = `${u.name} 的手牌 ${sn.hand}`;
    }
  }
}
function refreshBand() {
  const b = q1('.band');
  if (!b || !view) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = bandHtml(view, liveGame(), null, false, true);
  b.replaceWith(tmp.firstElementChild!);
}

// ---------- 文字特效 ----------
function float(layer: HTMLElement, unitId: string, text: string, cls: string) {
  const r = portraitRect(unitId);
  if (!r) return;
  const f = document.createElement('div');
  f.className = 'float ' + cls;
  const n = layer.querySelectorAll(`.float[data-u="${unitId}"]`).length;
  f.dataset.u = unitId;
  f.style.left = r.x + r.w / 2 + 'px';
  f.style.top = r.y + 40 + n * 44 + 'px';
  f.textContent = text;
  f.style.animationDuration = Math.max(0.5, 1.3 * speed) + 's';
  layer.appendChild(f);
  setTimeout(() => f.remove(), 1400 * Math.max(speed, 0.4));
}
function banner(p: PlayerIdx) {
  const b = document.createElement('div');
  b.className = 'turn-banner ' + rel(p);
  b.textContent = p === me ? '你的回合' : `${view!.players[p].name} 的回合`;
  stage.appendChild(b);
  setTimeout(() => b.remove(), 1700);
}
function shake(unitId: string, strong = false) {
  const el = q1(`.unit[data-unit="${unitId}"] .portrait`) as HTMLElement | null;
  const d = strong ? 14 : 9;
  el?.animate([{ translate: '0 0' }, { translate: `-${d}px 0` }, { translate: `${d}px 0` }, { translate: `-${d / 2}px 0` }, { translate: '0 0' }], { duration: 320 * speed });
  el?.animate([{ filter: 'brightness(2.2) saturate(0.4)' }, { filter: 'none' }], { duration: 260 * speed });
}

// ---------- 單一事件 ----------
async function playEvent(e: FxEvent, layer: HTMLElement, ghosts: Map<string, HTMLElement>) {
  const counterName = (unitId: string, id: string) => {
    const c = CHAR_DEFS[liveGame().unit(unitId).charId].counters?.find(x => x.id === id);
    return c && !c.hidden ? c.name : null;
  };
  switch (e.t) {
    case 'turn': {
      applySnap(e.s);
      refreshBand();
      banner(e.player);
      await sleep(950);
      return;
    }
    case 'draw': {
      playSfx('card');
      const from = deckRect(e.unitId);
      applySnap(e.s);
      if (isMine(e.unitId)) {
        const target = q1(`.hand [data-card="${e.uid}"]`) as HTMLElement | null;
        const to = rectOf(target) ?? handSpot(e.unitId);
        const defId = view!.players[me].units.flatMap(u => u.hand).find(c => c.uid === e.uid)?.defId ?? null;
        if (!from || !to) { target?.classList.remove('pending'); return; }
        const fl = makeFly(layer, defId, from, charOf(e.unitId));
        await flyTo(fl, from, to, 300);
        if (target) { target.classList.remove('pending'); fl.remove(); }
        else ghosts.set(e.uid, fl); // 抽到又馬上棄掉的牌：留著等下一個事件
      } else {
        const to = portraitRect(e.unitId);
        if (!from || !to) return;
        const fl = makeFly(layer, null, from, charOf(e.unitId));
        await flyTo(fl, from, { x: to.x + 20, y: to.y + 10, w: 90, h: 126 }, 260, { fade: true });
        fl.remove();
      }
      return;
    }
    case 'reshuffle': {
      const from = discardRect(e.unitId), to = deckRect(e.unitId);
      [0, 90, 180].forEach((t, i) => setTimeout(() => playSfx('card', { rate: 1.05 + i * 0.08 }), t * speed)); // 洗牌：連續幾聲
      if (from && to) {
        const flies = [0, 1, 2].map(() => makeFly(layer, null, from, charOf(e.unitId)));
        await Promise.all(flies.map((f, i) => sleep(i * 70).then(() => flyTo(f, from, to, 320))));
        flies.forEach(f => f.remove());
      }
      applySnap(e.s);
      return;
    }
    case 'play': {
      playSfx('card', { rate: 0.9 });
      applySnap(e.s);
      let fl = ghosts.get(e.uid);
      let from = fl ? rectFromEl(fl) : e.fromUnder ? underRect(e.unitId) : portraitRect(e.unitId);
      if (!from) return;
      if (!fl) fl = makeFly(layer, e.defId, from);
      else { fl.innerHTML = `<div class="card static">${cardInner(e.defId)}</div>`; ghosts.delete(e.uid); }
      fl.classList.add('glow-' + rel(Number(e.unitId[1]) as PlayerIdx));
      await flyTo(fl, from, BIG, 380, { arc: 20 });
      await sleep(650);
      setLastPlayed({ defId: e.defId, by: liveGame().unit(e.unitId).name, side: Number(e.unitId[1]) as PlayerIdx });
      refreshBand();
      const slot = showRect();
      if (slot) await flyTo(fl, BIG, slot, 260, { arc: 0 });
      fl.remove();
      return;
    }
    case 'playEnd': {
      playSfx('card', { gain: 0.6 });
      const from = showRect(), to = discardRect(e.unitId);
      if (from && to) {
        const fl = makeFly(layer, e.defId, from);
        // 使用後移出牌局的牌：不進棄牌區，直接往上淡出
        if (e.removed) await flyTo(fl, from, { ...from, y: from.y - 140, w: from.w * 0.8, h: from.h * 0.8 }, 320, { fade: true });
        else await flyTo(fl, from, to, 280, { arc: 20 });
        fl.remove();
      }
      applySnap(e.s);
      return;
    }
    case 'mill': {
      playSfx('card');
      // 從牌組移除 N 張到棄牌區：牌從牌組飛進棄牌堆
      const from = deckRect(e.unitId), to = discardRect(e.unitId);
      if (from && to) {
        const flies = Array.from({ length: Math.min(e.n, 5) }, () => makeFly(layer, null, from, charOf(e.unitId)));
        await Promise.all(flies.map((f, i) => sleep(i * 45).then(() => flyTo(f, from, to, 300, { fade: true }))));
        flies.forEach(f => f.remove());
      }
      applySnap(e.s);
      return;
    }
    case 'remove': {
      playSfx('card', { gain: 0.6, rate: 1.2 });
      // 移出牌局：從手牌或牌組往上淡出
      const ghost = e.uid ? ghosts.get(e.uid) : undefined;
      if (ghost) ghosts.delete(e.uid!);
      const from = ghost ? rectFromEl(ghost) : e.from === 'deck' ? deckRect(e.unitId) : portraitRect(e.unitId);
      if (!from) { applySnap(e.s); return; }
      const fl = ghost ?? makeFly(layer, e.defId, from, charOf(e.unitId));
      await flyTo(fl, from, { ...from, y: from.y - 140, w: from.w * 0.8, h: from.h * 0.8 }, 320, { fade: true });
      fl.remove();
      applySnap(e.s);
      return;
    }
    case 'discard': {
      playSfx('card', { gain: 0.7 });
      const to = discardRect(e.unitId);
      let fl = ghosts.get(e.uid);
      const from = fl ? rectFromEl(fl) : portraitRect(e.unitId);
      if (!from || !to) { fl?.remove(); applySnap(e.s); return; }
      if (!fl) fl = makeFly(layer, e.defId, from);
      ghosts.delete(e.uid);
      await flyTo(fl, from, to, 320);
      fl.remove();
      applySnap(e.s);
      return;
    }
    case 'devour': {
      const to = underRect(e.unitId);
      let fl = ghosts.get(e.uid);
      const from = fl ? rectFromEl(fl) : e.src === 'discard' ? discardRect(e.fromId) : portraitRect(e.fromId);
      if (e.src === 'discard') applySnap(e.s); // 先從棄牌區拿走
      if (!from || !to) { fl?.remove(); applySnap(e.s); return; }
      if (!fl) fl = makeFly(layer, e.defId, from);
      ghosts.delete(e.uid);
      fl.classList.add('devouring');
      await flyTo(fl, from, { x: to.x, y: to.y - 20, w: 60, h: 84 }, 420, { fade: true, arc: 60 });
      fl.remove();
      applySnap(e.s);
      float(layer, e.unitId, '吞噬！', 'devour');
      await sleep(200);
      return;
    }
    case 'toDiscard': {
      playSfx('card');
      const from = underRect(e.unitId), to = discardRect(e.unitId);
      if (from && to) {
        const flies = Array.from({ length: Math.min(e.n, 5) }, () => makeFly(layer, null, { ...from, w: 60, h: 84 }, charOf(e.unitId)));
        await Promise.all(flies.map((f, i) => sleep(i * 60).then(() => flyTo(f, { ...from, w: 60, h: 84 }, to, 320))));
        flies.forEach(f => f.remove());
      }
      applySnap(e.s);
      return;
    }
    case 'strike': {
      const a = q1(`.unit[data-unit="${e.unitId}"] .portrait`) as HTMLElement | null;
      const ra = portraitRect(e.unitId), rt = portraitRect(e.targetId);
      if (a && ra && rt) {
        const dx = (rt.x - ra.x) * 0.45, dy = (rt.y - ra.y) * 0.45;
        const anim = a.animate([{ translate: '0 0', zIndex: 40 }, { translate: `${dx}px ${dy}px`, zIndex: 40, offset: 0.45 }, { translate: '0 0', zIndex: 40 }], { duration: 360 * speed, easing: 'ease-in-out' });
        await sleep(160);
        playSfx('hit');
        const slash = document.createElement('div');
        slash.className = 'slash';
        slash.style.left = rt.x + rt.w / 2 + 'px';
        slash.style.top = rt.y + rt.h / 2 + 'px';
        layer.appendChild(slash);
        setTimeout(() => slash.remove(), 400);
        await anim.finished.catch(() => {});
      }
      return;
    }
    case 'damage': {
      applySnap(e.s);
      shake(e.unitId, e.amount >= 5);
      float(layer, e.unitId, `-${e.amount}`, 'dmg');
      await sleep(380);
      return;
    }
    case 'heal': {
      applySnap(e.s);
      float(layer, e.unitId, `+${e.amount}`, 'heal');
      await sleep(260);
      return;
    }
    case 'tp': {
      applySnap(e.s);
      float(layer, e.unitId, `TP -${e.amount}`, 'tp');
      await sleep(240);
      return;
    }
    case 'counter': {
      applySnap(e.s);
      const name = counterName(e.unitId, e.id);
      if (name) { float(layer, e.unitId, `${e.delta > 0 ? '+' : ''}${e.delta} ${name}`, 'counter'); await sleep(110); }
      return;
    }
    case 'status': {
      applySnap(e.s);
      float(layer, e.unitId, e.text, 'status');
      if (e.text === '處決' || e.text === '瀕死' || e.text === '重創') shake(e.unitId, true);
      await sleep(e.text === '處決' || e.text === '瀕死' ? 650 : 420);
      return;
    }
  }
}
