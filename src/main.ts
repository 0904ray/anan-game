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
let myName = '玩家';
try { myName = localStorage.getItem('cg-name') || '玩家'; } catch { /* 預覽環境可能不能用 localStorage */ }
/** 嵌在 Claude 預覽框裡時不能用 WebRTC，所以關掉連線功能 */
const ONLINE_OK = (() => { try { if (window.self !== window.top) return false; new RTCPeerConnection().close(); return true; } catch { return false; } })();
document.getElementById('rotate-ok')?.addEventListener('click', () => document.body.classList.add('rotate-ok'));

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
      <div class="sub">暫定名稱 · 測試版 v0.2</div>
      <div class="panel">
        <label>你的名字 <input id="name" maxlength="12" value="${esc(myName)}"></label>
        <button class="btn" data-act="host" ${ONLINE_OK ? '' : 'disabled'}>建立房間</button>
        <div class="join-row"><input id="code" maxlength="6" inputmode="numeric" placeholder="輸入房號" ${ONLINE_OK ? '' : 'disabled'}><button class="btn" data-act="join" ${ONLINE_OK ? '' : 'disabled'}>加入</button></div>
        <button class="btn ghost" data-act="bot">對戰電腦（隨機出牌）</button>
        <button class="btn ghost" data-act="hotseat">本機雙人（同一台輪流）</button>
        ${ONLINE_OK ? '' : '<div class="note">這個預覽版不能連線對戰，請先玩「對戰電腦」或「本機雙人」</div>'}
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
  if (n) { myName = n; try { localStorage.setItem('cg-name', n); } catch { } }
}

// =====================================================================
// 對戰畫面（方案 A 修改版）
//  敵方角色 ─ 中央帶（紀錄｜出牌展示區｜回合）─ 我方角色 ─ 手牌
//  左角色的牌組／棄牌在最左邊，右角色的在最右邊
// =====================================================================
function rel(p: PlayerIdx) { return p === me ? 'me' : 'op'; }
function liveGame(): Game { return new Game(view!); } // 用來在畫面上判斷操作是否合法

/** 出牌展示區目前顯示的牌 */
let lastPlayed: { defId: string; by: string; side: PlayerIdx } | null = null;
/** 滑鼠移到卡上時暫時預覽的牌（電腦用） */
let hoverDef: string | null = null;

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
  // 先記下這次的出牌，展示區才會顯示
  if (st.fxSeq !== lastFxSeq) for (const e of st.fx) if (e.t === 'play') lastPlayed = { defId: e.defId, by: g.unit(e.unitId).name, side: g.unit(e.unitId).owner };
  if (st.turn <= 1 && st.fx.length === 0) lastPlayed = null;

  const op = (1 - me) as PlayerIdx;
  const targetIds = myPrompt?.kind === 'unit' ? myPrompt.unitIds : [];

  let html = `<img class="bg-img" src="${ASSET.table}"><div class="board">`;
  for (const u of st.players[op].units) html += unitHtml(g, u, 'theirs', targetIds, myTurn) + miniPilesHtml(u);
  html += bandHtml(st, g, myPrompt, myTurn);
  for (const u of st.players[me].units) html += unitHtml(g, u, 'mine', targetIds, myTurn) + pilesHtml(u) + handHtml(g, u, myPrompt, myTurn);
  html += `</div>`;
  if (myPrompt && (myPrompt.kind === 'confirm' || myPrompt.kind === 'option' || myPrompt.kind === 'number')) html += modalHtml(myPrompt);
  if (st.winner !== null) html += gameOverHtml(st);

  stage.innerHTML = html;
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
  const counters = (c.counters ?? []).filter(ct => !ct.hidden).map(ct => `<span>${ct.name} <b class="gold">${u.counters[ct.id] ?? 0}</b></span>`).join('');
  const under = c.underName ? `<span class="underchip" data-under="${u.id}">${c.underName} <b>${u.under.length}</b> ▸</span>` : '';
  let actions = '';
  if (side === 'mine' && myTurn && u.life === 'alive') {
    const btn = (a: Action, label: string, extra = '') => {
      const err = g.checkAction(me, a);
      return `<button class="act-btn ${extra}" data-action='${esc(JSON.stringify(a))}' ${err ? `disabled title="${esc(err)}"` : ''}>${label}</button>`;
    };
    actions += btn({ type: 'attack', unitId: u.id }, `普攻 ${u.atkCost}`);
    actions += btn({ type: 'advance', unitId: u.id }, '居前 1');
    if (g.teammate(u).life === 'dying' && !view!.players[me].rescueUsed) actions += btn({ type: 'rescue', unitId: u.id }, `救治 ${g.teammate(u).tp * 2}`);
    for (const ab of c.abilities.filter(a => a.active)) actions += btn({ type: 'ability', unitId: u.id, abilityId: ab.id }, ab.name, 'ability');
  }
  const hpPct = Math.max(0, u.hp / u.maxHp * 100);
  return `
  <div class="${cls}" data-unit="${u.id}">
    <div class="portrait tilt" data-unit-click="${u.id}" style="--hue:${hue(u.charId)}">
      <div class="art"><span class="initial">${esc(CHAR_DEFS[u.charId].name[0])}</span><img src="${ASSET.char(u.charId)}"></div>
      <div class="badges">${badges(g, u)}</div>
      <div class="nameplate">${esc(u.name)}</div>
      <div class="shine"></div>
    </div>
    <div class="stats">
      <div class="hpbar"><div class="fill" style="width:${hpPct}%"></div><span>HP ${u.hp} / ${u.maxHp}${u.tHp ? ` (+${u.tHp})` : ''}</span></div>
      <div class="row"><label>TP</label><div class="pips">${tpPips}</div><label class="ap">AP</label><div class="pips">${apPips}</div></div>
      <div class="chips"><span>AT <b>${g.effAt(u)}</b>・SP <b>${g.effSp(u)}</b></span>${counters}${under}${side === 'theirs' ? `<span>手牌 <b>${u.hand.length}</b></span>` : ''}</div>
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </div>
  </div>`;
}

function cardInner(defId: string, big = false, cost?: number): string {
  const d = CARD_DEFS[defId];
  const c = cost ?? d.cost;
  const long = d.text.length + (d.discardText?.length ?? 0) > 46 ? 'long' : '';
  return `
    <div class="cost ${c < d.cost ? 'cheap' : ''}">${c}</div>
    <div class="art" style="--hue:${hue(defId)}"><span class="glyph">${esc(d.name[0])}</span><img src="${ASSET.card(defId)}"></div>
    <div class="cname">${esc(d.name)}</div>
    <div class="ctext ${long}">${esc(d.text)}${d.discardText ? `<span class="dis">${big ? '' : ' '}(棄置時) ${esc(d.discardText)}</span>` : ''}</div>
    <div class="owner">${esc(CHAR_DEFS[d.charId].name)}</div>`;
}

/** 我方牌堆：牌組在上、棄牌區在下 */
function pilesHtml(u: Unit): string {
  const top = u.discard[u.discard.length - 1];
  const deckCls = u.deck.length === 0 ? 'empty' : u.deck.length < 5 ? 'thin' : '';
  const dis = top
    ? `<div class="pile discard" data-pile="discard" data-pile-unit="${u.id}"><div class="mini-art" style="--hue:${hue(top.defId)}">${esc(CARD_DEFS[top.defId].name[0])}<img src="${ASSET.card(top.defId)}"></div><div class="mini-name">${esc(CARD_DEFS[top.defId].name)}</div><div class="count">棄牌 <b>${u.discard.length}</b></div></div>`
    : `<div class="pile discard empty" data-pile="discard" data-pile-unit="${u.id}"><div class="count">棄牌 <b>0</b></div></div>`;
  return `<div class="piles s${u.slot}">
    <div class="pile deck ${deckCls}" data-pile="deck" data-pile-unit="${u.id}">${u.deck.length ? `<img src="${ASSET.back}">` : ''}<div class="count">牌組 <b>${u.deck.length}</b></div></div>
    ${dis}
  </div>`;
}

/** 敵方的小牌堆 */
function miniPilesHtml(u: Unit): string {
  const top = u.discard[u.discard.length - 1];
  return `<div class="minipiles s${u.slot}">
    <div class="mp" data-pile="deck" data-pile-unit="${u.id}"><div></div>牌組 ${u.deck.length}</div>
    <div class="mp" data-pile="discard" data-pile-unit="${u.id}"><div class="dis ${top ? '' : 'empty'}" style="--hue:${top ? hue(top.defId) : 0}"></div>棄牌 ${u.discard.length}</div>
  </div>`;
}

function handHtml(g: Game, u: Unit, myPrompt: Prompt | null, myTurn: boolean): string {
  const n = u.hand.length;
  const W = 770, CW = 230;
  const step = n > 1 ? Math.min(CW + 12, (W - CW) / (n - 1)) : 0;
  const total = step * (n - 1) + CW;
  const start = (W - total) / 2;
  const selecting = myPrompt?.kind === 'cards' && myPrompt.unitId === u.id;
  let html = `<div class="hand s${u.slot}" data-hand="${u.id}"><div class="label">${esc(u.name)} 的手牌 ${n}</div>`;
  u.hand.forEach((c: CardInst, i: number) => {
    const mid = (n - 1) / 2;
    const rot = (i - mid) * 2.5;
    const y = Math.abs(i - mid) * Math.abs(i - mid) * 2;
    const playable = myTurn && u.life === 'alive' && g.checkAction(me, { type: 'play', unitId: u.id, cardUid: c.uid }) === null;
    const selectable = selecting && (myPrompt as any).cardUids.includes(c.uid);
    const cls = ['card', playable ? 'playable' : '', selectable ? 'selectable' : '', ui.selected.has(c.uid) ? 'selected' : '', ui.picked?.uid === c.uid ? 'picked' : ''].join(' ');
    html += `<div class="${cls}" data-card="${c.uid}" data-owner="${u.id}" data-preview-card="${c.defId}" style="--x:${start + i * step}px;--y:${y}px;--rot:${rot}deg;z-index:${i + 1}">${cardInner(c.defId, false, g.cardCost(u, c.defId))}</div>`;
  });
  return html + `</div>`;
}

/** 中央帶：紀錄｜出牌展示區｜回合 */
function bandHtml(st: GameState, g: Game, myPrompt: Prompt | null, myTurn: boolean): string {
  const lines = st.log.slice(-5).map(l => {
    const cls = l.text.startsWith('——') ? 'sys' : l.side === undefined ? '' : rel(l.side);
    return `<div class="line ${cls}">${esc(l.text)}</div>`;
  }).join('');

  // 展示區內容（優先順序：我要做的選擇 > 準備打出的牌 > 最近打出的牌）
  let cardDef: string | null = lastPlayed?.defId ?? null;
  let cardCls = lastPlayed ? rel(lastPlayed.side) : 'me';
  let label = '出牌展示區';
  let main = '';
  let mainCls = 'me';
  let sub = '';
  let btns = '';
  if (st.winner !== null) { main = '對戰結束'; }
  else if (myPrompt?.kind === 'unit') { label = '請選擇'; main = esc(myPrompt.title); sub = '點選發光的角色'; }
  else if (myPrompt?.kind === 'cards') {
    const ok = ui.selected.size >= myPrompt.min && ui.selected.size <= myPrompt.max;
    label = '請選擇手牌'; main = esc(myPrompt.title);
    sub = `已選 ${ui.selected.size}${myPrompt.min === myPrompt.max ? ` / ${myPrompt.max}` : `（${myPrompt.min}～${myPrompt.max} 張）`}`;
    btns = `<button class="btn small" data-answer-cards ${ok ? '' : 'disabled'}>確定</button>`;
  } else if (myPrompt) { label = '請選擇'; main = esc(myPrompt.title); }
  else if (st.prompt) { main = `等待 ${esc(st.players[st.prompt.player].name)} 做選擇…`; mainCls = 'op'; }
  else if (myTurn && ui.picked) {
    const c = g.unit(ui.picked.unitId).hand.find(x => x.uid === ui.picked!.uid)!;
    const d = CARD_DEFS[c.defId];
    cardDef = c.defId; cardCls = 'me';
    label = '準備打出'; main = `${esc(g.unit(ui.picked.unitId).name)}：【${esc(d.name)}】`; sub = `花費 ${g.cardCost(g.unit(ui.picked.unitId), c.defId)} AP`;
    btns = `<button class="btn small" data-play-picked>打出</button><button class="btn small ghost" data-cancel-pick>取消</button>`;
  } else if (lastPlayed) {
    mainCls = rel(lastPlayed.side);
    main = `${lastPlayed.side === me ? '' : '對手的 '}${esc(lastPlayed.by)} 打出【${esc(CARD_DEFS[lastPlayed.defId].name)}】`;
    sub = myTurn ? '你的回合：點手牌出牌，或用角色旁的按鈕' : `${esc(st.players[st.active].name)} 的回合…`;
  } else {
    main = myTurn ? '你的回合' : `${esc(st.players[st.active].name)} 的回合…`;
    mainCls = myTurn ? 'me' : 'op';
    sub = '打出的牌會顯示在這裡';
  }
  if (hoverDef && !myPrompt && !ui.picked) { cardDef = hoverDef; cardCls = 'me'; }
  const cardHtml = cardDef
    ? `<div class="showcard ${cardCls}" id="showcard" data-preview-card="${cardDef}">${cardInner(cardDef)}</div>`
    : `<div class="slot" id="showcard">出牌<br>展示區</div>`;

  return `<div class="band">
    <div class="logbox"><div class="head"><span>戰鬥紀錄</span><button class="btn ghost small" data-act="fulllog">展開</button></div>${lines}</div>
    <div class="show">${cardHtml}<div class="info"><span class="label">${label}</span><span class="main ${mainCls}">${main}</span>${sub ? `<span class="sub">${sub}</span>` : ''}${btns ? `<div class="btns">${btns}</div>` : ''}</div></div>
    <div class="turn">
      <div class="t1"><span>第 ${st.turn} 回合</span><span class="who ${rel(st.active)}">${st.active === me ? '你的回合' : esc(st.players[st.active].name)}</span></div>
      <button class="btn endturn ${myTurn ? 'glow' : ''}" data-end ${myTurn ? '' : 'disabled'}>結束回合</button>
      <button class="btn ghost small" data-act="menu">選單</button>
    </div>
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

// 頁內彈出視窗（角色說明、完整紀錄、棄牌區內容、選單）
function popup(inner: string) {
  stage.querySelector('.popup-bg')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg popup-bg';
  el.innerHTML = `<div class="modal">${inner}<div class="row2"><button class="btn ghost" data-act="close-popup">關閉</button></div></div>`;
  stage.appendChild(el);
  const log = el.querySelector('.fulllog');
  if (log) log.scrollTop = log.scrollHeight;
}
function showCharSheet(unitId: string) {
  const u = liveGame().unit(unitId);
  const c = CHAR_DEFS[u.charId];
  popup(`<div class="charsheet">
    <h3>${esc(u.name)}</h3><div class="tag">${esc(c.title)}　HP ${c.hp}｜AP ${c.ap}｜TP ${c.tp}｜AT ${c.at} × AP ${c.atkCost}</div>
    ${c.abilities.map((a, i) => `<div class="ab"><b>${i + 1}. ${esc(a.name)}</b>${a.active ? '<span class="act">主動</span>' : ''}：${esc(a.text)}</div>`).join('')}
    <div class="lore">${esc(c.lore)}</div></div>`);
}
function showFullLog() {
  const st = view!;
  popup(`<h2>戰鬥紀錄</h2><div class="fulllog">${st.log.map(l => {
    const cls = l.text.startsWith('——') ? 'sys' : l.side === undefined ? '' : rel(l.side);
    return `<div class="${cls}">${esc(l.text)}</div>`;
  }).join('')}</div>`);
}
function showPile(unitId: string, kind: 'deck' | 'discard') {
  const u = liveGame().unit(unitId);
  const pile = kind === 'deck' ? u.deck : u.discard;
  const hidden = pile.some(c => c.defId === 'hidden');
  const counts = new Map<string, number>();
  for (const c of pile) counts.set(c.defId, (counts.get(c.defId) ?? 0) + 1);
  const items = hidden ? `<div class="item">對手的牌組內容看不到（${pile.length} 張）</div>`
    : pile.length === 0 ? `<div class="item">沒有牌</div>`
    : [...counts].map(([id, n]) => `<div class="item"><b>×${n}</b>${esc(CARD_DEFS[id].name)}</div>`).join('');
  popup(`<h2>${esc(u.name)} 的${kind === 'deck' ? '牌組（剩下的牌，順序隱藏）' : '棄牌區'}　${pile.length} 張</h2><div class="cardlist">${items}</div>`);
}
/** 壓在角色下方的牌（葛蘭妮的吞噬）：可以直接從這裡使用 */
function showUnder(unitId: string) {
  const g = liveGame();
  const u = g.unit(unitId);
  const c = CHAR_DEFS[u.charId];
  const myTurn = view!.winner === null && !view!.prompt && view!.active === me;
  const items = u.under.map(card => {
    const a: Action = { type: 'playUnder', unitId: u.id, cardUid: card.uid };
    const err = u.owner === me && myTurn ? g.checkAction(me, a) : '不是你的回合';
    const btn = u.owner === me ? `<button class="act-btn" data-action='${esc(JSON.stringify(a))}' ${err ? `disabled title="${esc(err)}"` : ''}>使用</button>` : '';
    return `<div class="underitem"><div class="showcard me">${cardInner(card.defId, false, g.cardCost(u, card.defId))}</div>${btn}</div>`;
  }).join('');
  popup(`<h2>${esc(u.name)} 的${c.underName ?? '下方'}牌堆　${u.under.length} 張（每張 AT +1）</h2>
    <div class="underlist">${items || '<div class="item">還沒有吞噬任何牌</div>'}</div>
    ${u.owner === me ? '<div class="hint2">使用吞噬的牌：照卡面費用付 AP，用完進棄牌區，+1 暴食</div>' : ''}`);
}

function showMenu() {
  popup(`<h2>離開這場對戰，回到大廳？</h2><div class="row2"><button class="btn" data-act="lobby">回到大廳</button></div>`);
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
      const b = document.createElement('div');
      b.className = 'turn-banner ' + rel(e.player);
      b.textContent = e.player === me ? '你的回合' : `${st.players[e.player].name} 的回合`;
      stage.appendChild(b);
      setTimeout(() => b.remove(), 1700);
      lastActive = e.player;
      continue;
    }
    if (e.t === 'play') {
      if (showcaseDone) continue;
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
function send(a: Action) { ui.picked = null; hoverDef = null; session?.send(a); }

stage.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => t.closest(sel) as T | null;

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
    } else if (k === 'rematch') { lastPlayed = null; session?.rematch(); }
    else if (k === 'lobby') { lastPlayed = null; renderLobby(); }
    else if (k === 'menu') showMenu();
    else if (k === 'fulllog') showFullLog();
    else if (k === 'close-popup') stage.querySelector('.popup-bg')?.remove();
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
  const c = (e.target as HTMLElement).closest('.hand [data-preview-card]') as HTMLElement | null;
  const slot = document.getElementById('showcard');
  if (!c || !slot || ui.picked || view?.prompt) return;
  const id = c.dataset.previewCard!;
  if (hoverDef === id) return;
  hoverDef = id;
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

// 測試用：網址加 ?autostart=bot 或 ?autostart=hotseat 直接開始
const auto = new URLSearchParams(location.search).get('autostart');
if (auto === 'bot' || auto === 'hotseat') session = new LocalSession(auto, events, [myName, auto === 'bot' ? '電腦' : '玩家二']);
else renderLobby();
