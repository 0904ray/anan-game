import './style.css';
import { Game, CARD_DEFS, CHAR_DEFS, type Action, type GameState, type PlayerIdx, type Unit, type CardInst, type Prompt } from './engine';
import { LocalSession, HostSession, GuestSession, randomRoomCode, type Session } from './net/session';

// =====================================================================
// 圖片路徑：檔案放進 assets 資料夾就會自動換上，沒有就顯示佔位圖
// =====================================================================
const ASSET = {
  char: (id: string) => `assets/chars/${id}.png`,
  card: (id: string) => `assets/cards/${id}.png`,
  table: 'assets/bg/table.png',
  lobby: 'assets/bg/lobby.png',
  back: 'assets/ui/card-back.png',
};

const stage = document.getElementById('stage')!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

// 圖片載入失敗 → 隱藏，露出佔位圖
document.addEventListener('error', e => { const t = e.target as HTMLElement; if (t?.tagName === 'IMG') t.classList.add('missing'); }, true);

// 16:9 等比縮放
function fit() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

// =====================================================================
// 狀態
// =====================================================================
let session: Session | null = null;
let view: GameState | null = null;
let me: PlayerIdx = 0;
let lastFxSeq = -1;
let lastActive: PlayerIdx | null = null;
const ui = {
  selected: new Set<string>(),   // 選牌視窗中已選的牌
  picked: null as { unitId: string; uid: string } | null, // 準備打出的牌
  numberVal: 0,
};
let myName = localStorage.getItem('cg-name') || '玩家';

// =====================================================================
// 大廳
// =====================================================================
function renderLobby(status = '', roomCode = '') {
  session?.close();
  session = null;
  view = null;
  stage.innerHTML = `
    <img class="bg-img" src="${ASSET.lobby}">
    <div class="lobby">
      <h1>冷倫卡牌對戰</h1>
      <div class="sub">暫定名稱 · 測試版 v0.1</div>
      <div class="panel">
        <label>你的名字 <input id="name" maxlength="12" value="${esc(myName)}"></label>
        <button class="btn" data-act="host">建立房間</button>
        <div class="join-row"><input id="code" maxlength="6" placeholder="輸入房號"><button class="btn" data-act="join">加入</button></div>
        <button class="btn ghost" data-act="bot">對戰電腦（隨機出牌）</button>
        <button class="btn ghost" data-act="hotseat">本機雙人（同一台輪流）</button>
      </div>
      ${roomCode ? `<div class="roomcode">${roomCode}</div>` : ''}
      <div class="status">${esc(status)}</div>
      ${roomCode ? `<button class="btn ghost small" data-act="lobby">取消</button>` : ''}
    </div>`;
}

const events = {
  onState(v: GameState, m: PlayerIdx) { view = v; me = m; renderGame(); },
  onStatus(t: string) { if (!view) { const el = stage.querySelector('.lobby .status'); if (el) el.textContent = t; } else toast(t); },
  onError(t: string) { if (!view) { const el = stage.querySelector('.lobby .status'); if (el) el.textContent = t; } else toast(t); },
};

function readName() {
  const n = (stage.querySelector('#name') as HTMLInputElement | null)?.value.trim();
  if (n) { myName = n; localStorage.setItem('cg-name', n); }
}

// =====================================================================
// 對戰畫面
// =====================================================================
function rel(p: PlayerIdx) { return p === me ? 'me' : 'op'; }

function liveGame(): Game { return new Game(view!); } // 用來在畫面上判斷操作是否合法

function renderGame() {
  if (!view) return;
  const st = view;
  const g = liveGame();
  const prompt = st.prompt;
  const myPrompt = prompt && prompt.player === me ? prompt : null;
  const myTurn = st.winner === null && !prompt && st.active === me;
  if (!myPrompt || myPrompt.kind !== 'cards') ui.selected.clear();
  if (!myTurn) ui.picked = null;
  if (ui.picked) {
    const u = g.unit(ui.picked.unitId);
    if (!u.hand.some(c => c.uid === ui.picked!.uid)) ui.picked = null;
  }

  const op = (1 - me) as PlayerIdx;
  const targetIds = myPrompt?.kind === 'unit' ? myPrompt.unitIds : [];

  let html = `<img class="bg-img" src="${ASSET.table}"><div class="board">`;
  // 對手手牌背面
  for (const u of st.players[op].units) {
    const n = u.hand.length;
    html += `<div class="ophand s${u.slot}">${Array.from({ length: Math.min(n, 12) }, () => `<div class="cardback"><img src="${ASSET.back}"></div>`).join('')}<span class="count">手牌 ${n}</span></div>`;
  }
  for (const u of st.players[op].units) html += unitHtml(g, u, 'theirs', targetIds, myTurn);
  for (const u of st.players[me].units) html += unitHtml(g, u, 'mine', targetIds, myTurn);
  html += bannerHtml(st, myPrompt, myTurn);
  for (const u of st.players[me].units) html += handHtml(g, u, myPrompt, myTurn);
  html += `</div>`;
  html += sidebarHtml(st, myTurn);
  if (myPrompt && (myPrompt.kind === 'confirm' || myPrompt.kind === 'option' || myPrompt.kind === 'number')) html += modalHtml(myPrompt);
  if (st.winner !== null) html += gameOverHtml(st);

  stage.innerHTML = html;
  const log = stage.querySelector('.log');
  if (log) log.scrollTop = log.scrollHeight;
  playFx(st);
}

function badges(g: Game, u: Unit): string {
  const b: string[] = [];
  if (u.life === 'dead') b.push(`<span class="badge dead">死亡</span>`);
  else if (u.life === 'dying') b.push(`<span class="badge dying">瀕死</span>`);
  else {
    if (u.critical) b.push(`<span class="badge crit">重創</span>`);
    else if (g.isWounded(u)) b.push(`<span class="badge wound">負傷</span>`);
    if (u.spBonus) b.push(`<span class="badge sp">居前</span>`);
    if (u.dmgReduce) b.push(`<span class="badge buff">減傷${u.dmgReduce}</span>`);
    if (u.noWound) b.push(`<span class="badge buff">不負傷</span>`);
    if (u.noTpLoss) b.push(`<span class="badge buff">TP鎖定</span>`);
    if (u.halfTpNext) b.push(`<span class="badge crit">半回TP</span>`);
  }
  return b.join('');
}

function unitHtml(g: Game, u: Unit, side: 'mine' | 'theirs', targetIds: string[], myTurn: boolean): string {
  const c = CHAR_DEFS[u.charId];
  const targetable = targetIds.includes(u.id);
  const cls = ['unit', side, 's' + u.slot, u.life !== 'alive' ? u.life : '', targetable ? 'targetable' : '', targetable && u.owner === me ? 'ally' : ''].join(' ');
  const half = Math.floor(u.tpMax / 2);
  const tpPips = Array.from({ length: u.tpMax }, (_, i) => `<div class="pip tp ${i < u.tp ? 'on' : ''} ${u.tp <= half && u.life === 'alive' ? 'low' : ''} ${i === half - 1 ? 'half' : ''}"></div>`).join('');
  const apPips = Array.from({ length: u.apMax }, (_, i) => `<div class="pip ap ${i < u.ap ? 'on' : ''}"></div>`).join('');
  const counters = (c.counters ?? []).map(ct => `${ct.name} <b>${u.counters[ct.id] ?? 0}</b>`).join(' ');
  let actions = '';
  if (side === 'mine' && myTurn && u.life === 'alive') {
    const btn = (a: Action, label: string, extra = '') => {
      const err = g.checkAction(me, a);
      return `<button class="act-btn ${extra}" data-action='${esc(JSON.stringify(a))}' ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
    };
    actions += btn({ type: 'attack', unitId: u.id }, `普攻（${u.atkCost}）`);
    actions += btn({ type: 'advance', unitId: u.id }, '居前（1）');
    if (g.teammate(u).life === 'dying' && !view!.players[me].rescueUsed) actions += btn({ type: 'rescue', unitId: u.id }, `救治（${g.teammate(u).tp * 2}）`);
    for (const ab of c.abilities.filter(a => a.active)) actions += btn({ type: 'ability', unitId: u.id, abilityId: ab.id }, ab.name, 'ability');
  }
  const hpPct = Math.max(0, u.hp / u.maxHp * 100);
  return `
  <div class="${cls}" data-unit="${u.id}">
    <div class="portrait tilt" data-unit-click="${u.id}" data-preview-unit="${u.id}" style="--hue:${hue(u.charId)}">
      <div class="art"><span class="initial">${esc(CHAR_DEFS[u.charId].name[0])}</span><img src="${ASSET.char(u.charId)}"></div>
      <div class="badges">${badges(g, u)}</div>
      <div class="nameplate">${esc(u.name)}</div>
      <div class="shine"></div>
    </div>
    <div class="stats">
      <div class="hpbar"><div class="fill" style="width:${hpPct}%"></div><span>HP ${u.hp} / ${u.maxHp}${u.tHp ? ` (+${u.tHp})` : ''}</span></div>
      <div class="row"><label>TP</label><div class="pips">${tpPips}</div><span>${u.tp}/${u.tpMax}</span></div>
      <div class="row"><label>AP</label><div class="pips">${apPips}</div><span>${u.ap}/${u.apMax}</span></div>
      <div class="row mini"><span>AT <b>${u.at}</b></span><span>SP <b>${g.effSp(u)}</b></span>${counters ? `<span>${counters}</span>` : ''}</div>
      <div class="row mini"><span>牌組 <b>${u.deck.length}</b></span><span>棄牌 <b>${u.discard.length}</b></span>${side === 'theirs' ? `<span>手牌 <b>${u.hand.length}</b></span>` : ''}</div>
      <div class="actions">${actions}</div>
    </div>
  </div>`;
}

function cardInner(defId: string, big = false): string {
  const d = CARD_DEFS[defId];
  return `
    <div class="cost">${d.cost}</div>
    <div class="art" style="--hue:${hue(defId)}"><span class="glyph">${esc(d.name[0])}</span><img src="${ASSET.card(defId)}"></div>
    <div class="cname">${esc(d.name)}</div>
    <div class="ctext">${esc(d.text)}${d.discardText ? `<span class="dis">${big ? '' : ' '}(棄置時) ${esc(d.discardText)}</span>` : ''}</div>
    ${big ? `<div class="owner">${esc(CHAR_DEFS[d.charId].name)}</div>` : ''}`;
}

function handHtml(g: Game, u: Unit, myPrompt: Prompt | null, myTurn: boolean): string {
  const n = u.hand.length;
  const W = 690, CW = 160;
  const step = n > 1 ? Math.min(CW + 10, (W - CW) / (n - 1)) : 0;
  const total = step * (n - 1) + CW;
  const start = (W - total) / 2;
  const selecting = myPrompt?.kind === 'cards' && myPrompt.unitId === u.id;
  let html = `<div class="hand s${u.slot}"><div class="label">${esc(u.name)} 的手牌（${n}）</div>`;
  u.hand.forEach((c: CardInst, i: number) => {
    const mid = (n - 1) / 2;
    const rot = (i - mid) * 3;
    const y = Math.abs(i - mid) * Math.abs(i - mid) * 2;
    const playable = myTurn && u.life === 'alive' && g.checkAction(me, { type: 'play', unitId: u.id, cardUid: c.uid }) === null;
    const selectable = selecting && (myPrompt as any).cardUids.includes(c.uid);
    const cls = ['card', playable ? 'playable' : '', selectable ? 'selectable' : '', ui.selected.has(c.uid) ? 'selected' : '', ui.picked?.uid === c.uid ? 'picked' : ''].join(' ');
    html += `<div class="${cls}" data-card="${c.uid}" data-owner="${u.id}" data-preview-card="${c.defId}" style="--x:${start + i * step}px;--y:${y}px;--rot:${rot}deg;z-index:${i + 1}">${cardInner(c.defId)}</div>`;
  });
  return html + `</div>`;
}

function bannerHtml(st: GameState, myPrompt: Prompt | null, myTurn: boolean): string {
  let inner = '';
  if (st.winner !== null) inner = `<div class="msg">對戰結束</div>`;
  else if (myPrompt?.kind === 'unit') inner = `<div class="msg mine">${esc(myPrompt.title)}（點選發光的角色）</div>`;
  else if (myPrompt?.kind === 'cards') {
    const ok = ui.selected.size >= myPrompt.min && ui.selected.size <= myPrompt.max;
    inner = `<div class="msg mine">${esc(myPrompt.title)}　已選 ${ui.selected.size}${myPrompt.min === myPrompt.max ? ` / ${myPrompt.max}` : `（${myPrompt.min}～${myPrompt.max}）`}</div>
      <button class="btn small" data-answer-cards ${ok ? '' : 'disabled'}>確定</button>`;
  } else if (myPrompt) inner = `<div class="msg mine">${esc(myPrompt.title)}</div>`;
  else if (st.prompt) inner = `<div class="msg wait">等待 ${esc(st.players[st.prompt.player].name)} 做選擇…</div>`;
  else if (myTurn && ui.picked) {
    const d = CARD_DEFS[liveGame().unit(ui.picked.unitId).hand.find(c => c.uid === ui.picked!.uid)!.defId];
    inner = `<div class="msg mine">打出【${esc(d.name)}】（${d.cost} AP）？</div>
      <button class="btn small" data-play-picked>打出</button><button class="btn small ghost" data-cancel-pick>取消</button>`;
  } else if (myTurn) inner = `<div class="msg mine">你的回合：點手牌出牌，或使用角色下方的按鈕</div>`;
  else inner = `<div class="msg wait">${esc(st.players[st.active].name)} 的回合…</div>`;
  return `<div class="banner">${inner}</div>`;
}

function sidebarHtml(st: GameState, myTurn: boolean): string {
  const activeName = st.players[st.active].name;
  const logHtml = st.log.slice(-120).map(l => {
    const cls = l.text.startsWith('——') ? 'sys' : l.side === undefined ? '' : rel(l.side);
    return `<div class="${cls}">${esc(l.text)}</div>`;
  }).join('');
  return `
  <div class="sidebar">
    <div class="turninfo"><span>第 ${st.turn} 回合</span><span class="who ${rel(st.active)}">${esc(activeName)}</span>
      <button class="btn ghost small" data-act="menu">選單</button></div>
    <button class="btn endturn ${myTurn ? 'glow' : ''}" data-end ${myTurn ? '' : 'disabled'}>結束回合</button>
    <div class="preview" id="preview"><div class="hint">把滑鼠移到卡牌或角色上<br>這裡會顯示完整說明</div></div>
    <div class="log">${logHtml}</div>
  </div>`;
}

function modalHtml(p: Prompt): string {
  let body = '';
  if (p.kind === 'confirm') body = `<div class="row2"><button class="btn" data-answer='true'>${esc(p.yes)}</button><button class="btn ghost" data-answer='false'>${esc(p.no)}</button></div>`;
  if (p.kind === 'option') body = `<div class="opts">${p.options.map((o, i) => `<button class="btn" data-answer='${i}'>${esc(o)}</button>`).join('')}</div>`;
  if (p.kind === 'number') {
    ui.numberVal = Math.min(Math.max(ui.numberVal, p.min), p.max);
    body = `<input type="range" id="numrange" min="${p.min}" max="${p.max}" step="1" value="${ui.numberVal}">
      <div class="numval" id="numval">${p.label} ${ui.numberVal}</div>
      <div class="row2"><button class="btn" data-answer-number>確定</button></div>`;
  }
  return `<div class="modal-bg"><div class="modal"><h2>${esc(p.title)}</h2>${body}</div></div>`;
}

function gameOverHtml(st: GameState): string {
  const w = st.winner;
  const text = w === 'draw' ? '平手' : w === me ? '勝利' : '敗北';
  const cls = w === me ? 'win' : 'lose';
  return `<div class="gameover"><h1 class="${cls}">${text}</h1>
    <div class="row2"><button class="btn" data-act="rematch">再來一局</button><button class="btn ghost" data-act="lobby">回到大廳</button></div></div>`;
}

// =====================================================================
// 右側說明
// =====================================================================
function showPreviewCard(defId: string) {
  const el = document.getElementById('preview');
  if (!el || !CARD_DEFS[defId]) return;
  el.innerHTML = `<div class="bigcard">${cardInner(defId, true)}</div>`;
}
function showPreviewUnit(unitId: string) {
  const el = document.getElementById('preview');
  if (!el || !view) return;
  const u = liveGame().unit(unitId);
  const c = CHAR_DEFS[u.charId];
  el.innerHTML = `<div class="charsheet">
    <h3>${esc(c.name)}</h3><div class="tag">${esc(c.title)}　HP ${c.hp}｜AP ${c.ap}｜TP ${c.tp}｜AT ${c.at} × AP ${c.atkCost}</div>
    ${c.abilities.map((a, i) => `<div class="ab"><b>${i + 1}. ${esc(a.name)}</b>${a.active ? '<span class="act">主動</span>' : ''}：${esc(a.text)}</div>`).join('')}
    <div class="ab" style="color:#9d8c70;margin-top:12px;font-size:15px">${esc(c.lore)}</div>
  </div>`;
}

// =====================================================================
// 特效
// =====================================================================
function playFx(st: GameState) {
  if (st.fxSeq === lastFxSeq) return;
  lastFxSeq = st.fxSeq;
  let showcaseDone = false;
  for (const e of st.fx) {
    if (e.t === 'turn') {
      if (lastActive !== e.player || true) {
        const b = document.createElement('div');
        b.className = 'turn-banner ' + rel(e.player);
        b.textContent = e.player === me ? '你的回合' : `${st.players[e.player].name} 的回合`;
        stage.appendChild(b);
        setTimeout(() => b.remove(), 1700);
      }
      lastActive = e.player;
      continue;
    }
    if (e.t === 'play' && !showcaseDone) {
      showcaseDone = true;
      const sc = document.createElement('div');
      sc.className = 'showcase';
      sc.innerHTML = `<div class="bigcard">${cardInner(e.defId, true)}</div>`;
      stage.appendChild(sc);
      setTimeout(() => sc.remove(), 1500);
      continue;
    }
    const host = stage.querySelector(`.unit[data-unit="${e.unitId}"]`) as HTMLElement | null;
    if (!host) continue;
    const f = document.createElement('div');
    const offset = host.querySelectorAll('.float').length * 46;
    f.style.marginTop = offset + 'px';
    if (e.t === 'damage') {
      f.className = 'float dmg'; f.textContent = `-${e.amount}`;
      host.classList.add('shake');
    } else if (e.t === 'heal') { f.className = 'float heal'; f.textContent = `+${e.amount}`; }
    else if (e.t === 'tp') { f.className = 'float tp'; f.textContent = `TP -${e.amount}`; }
    else if (e.t === 'status') { f.className = 'float status'; f.textContent = e.text; }
    host.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }
}

let toastTimer: any;
function toast(t: string) {
  stage.querySelectorAll('.toast').forEach(x => x.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = t;
  stage.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2300);
}

// =====================================================================
// 輸入
// =====================================================================
function send(a: Action) { ui.picked = null; session?.send(a); }

stage.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => t.closest(sel) as T | null;

  // 大廳
  const act = q('[data-act]');
  if (act) {
    const k = act.dataset.act;
    readName();
    if (k === 'bot') session = new LocalSession('bot', events, [myName, '電腦']);
    else if (k === 'hotseat') session = new LocalSession('hotseat', events, [myName, '玩家二']);
    else if (k === 'host') { const code = randomRoomCode(); renderLobby('正在建立房間…', code); session = new HostSession(code, myName, events); }
    else if (k === 'join') {
      const code = (stage.querySelector('#code') as HTMLInputElement).value.trim();
      if (!/^\d{6}$/.test(code)) { events.onError('房號是 6 位數字'); return; }
      session = new GuestSession(code, myName, events);
    } else if (k === 'rematch') session?.rematch();
    else if (k === 'lobby') renderLobby();
    else if (k === 'menu') { if (confirmLeave()) renderLobby(); }
    return;
  }
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

  const unitEl = q('[data-unit-click]');
  if (unitEl && myPrompt?.kind === 'unit') {
    const id = unitEl.dataset.unitClick!;
    if (myPrompt.unitIds.includes(id)) send({ type: 'answer', value: id });
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
      const g = liveGame();
      const err = g.checkAction(me, { type: 'play', unitId: cardEl.dataset.owner!, cardUid: uid });
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

// 滑鼠移上去：右側顯示說明＋卡片傾斜
stage.addEventListener('mouseover', e => {
  const t = e.target as HTMLElement;
  const c = t.closest('[data-preview-card]') as HTMLElement | null;
  if (c) { showPreviewCard(c.dataset.previewCard!); return; }
  const u = t.closest('[data-preview-unit]') as HTMLElement | null;
  if (u) showPreviewUnit(u.dataset.previewUnit!);
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

function confirmLeave() { return window.confirm('離開這場對戰回到大廳？'); }

// 測試用：網址加 ?autostart=bot 或 ?autostart=hotseat 直接開始
const auto = new URLSearchParams(location.search).get('autostart');
if (auto === 'bot' || auto === 'hotseat') session = new LocalSession(auto, events, [myName, auto === 'bot' ? '電腦' : '玩家二']);
else renderLobby();
