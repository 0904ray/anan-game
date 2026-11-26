// 對戰畫面：把遊戲狀態畫成 HTML（不處理輸入、不播動畫）
import { Game, CARD_DEFS, CHAR_DEFS, legalActions, findKeyword, keywordNames, type Action, type GameState, type PlayerIdx, type Unit, type CardInst, type Prompt, type UnitSnap } from '../engine';
import { ASSET, esc, hue, stage } from './dom';
import { view, me, ui, lastPlayed, hoverDef, rel, liveGame } from './state';

// =====================================================================
// 對戰畫面（方案 A 修改版）
//  敵方角色 ─ 中央帶（紀錄｜出牌展示區｜回合）─ 我方角色 ─ 手牌
//  左角色的牌組／棄牌在最左邊，右角色的在最右邊
// =====================================================================


/** 播動畫時：角色數值照事件快照顯示、剛抽到的牌先藏起來 */
export interface AnimCtx { snaps: UnitSnap[]; hidden: Set<string> }

/** 把事件快照套到角色上（畫面顯示用的假角色） */
export function mergeSnap(u: Unit, snaps: UnitSnap[]): Unit {
  const sn = snaps.find(x => x.id === u.id);
  if (!sn) return u;
  const dummy = (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => ({ uid: 'x' + i, defId: 'hidden' }));
  return {
    ...u, hp: sn.hp, tp: sn.tp, ap: sn.ap, tHp: sn.tHp, life: sn.life, critical: sn.critical, spBonus: sn.spBonus,
    dmgReduce: sn.dmgReduce, noWound: sn.noWound, noTpLoss: sn.noTpLoss, halfTpNext: sn.halfTpNext,
    counters: sn.counters, under: dummy(sn.under), deck: dummy(sn.deck),
    discard: sn.discard ? [...dummy(sn.discard - 1), { uid: 'top', defId: sn.discardTop! }] : [],
    hand: u.owner === me ? u.hand : dummy(sn.hand),
  };
}

export function renderGame(anim?: AnimCtx) {
  if (!view) return;
  const st = view;
  const g = liveGame();
  const ro = !!anim; // 播動畫中：只顯示，不能操作
  const prompt = st.prompt;
  const myPrompt = !ro && prompt && prompt.player === me ? prompt : null;
  const myTurn = !ro && st.winner === null && !prompt && st.active === me;
  if (!ro) {
    if (!myPrompt || myPrompt.kind !== 'cards') ui.selected.clear();
    if (!myTurn) ui.picked = null;
    if (ui.picked) {
      const u = g.unit(ui.picked.unitId);
      if (!u.hand.some(c => c.uid === ui.picked!.uid)) ui.picked = null;
    }
  }
  const show = (u: Unit) => (anim ? mergeSnap(u, anim.snaps) : u);
  const op = (1 - me) as PlayerIdx;
  const targetIds = myPrompt?.kind === 'unit' ? myPrompt.unitIds : [];

  let html = `<img class="bg-img table" src="${ASSET.table}"><div class="board">`;
  for (const u of st.players[op].units) html += unitHtml(g, show(u), 'theirs', targetIds, myTurn) + miniPilesHtml(show(u));
  html += bandHtml(st, g, myPrompt, myTurn, ro);
  for (const u of st.players[me].units) html += unitHtml(g, show(u), 'mine', targetIds, myTurn) + pilesHtml(show(u)) + handHtml(g, u, myPrompt, myTurn, anim?.hidden);
  html += `</div><div class="fxlayer"></div>`;
  if (!ro && myPrompt && (myPrompt.kind === 'confirm' || myPrompt.kind === 'option' || myPrompt.kind === 'number')) html += modalHtml(myPrompt);
  if (!ro && st.winner !== null) html += gameOverHtml(st);
  stage.innerHTML = html;
}

export function badges(g: Game, u: Unit): string {
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

export function unitHtml(g: Game, u: Unit, side: 'mine' | 'theirs', targetIds: string[], myTurn: boolean): string {
  const c = CHAR_DEFS[u.charId];
  const targetable = targetIds.includes(u.id);
  const cls = ['unit', side, 's' + u.slot, view && view.active !== u.owner ? 'off-turn' : '', u.life !== 'alive' ? u.life : '', targetable ? 'targetable' : '', targetable && u.owner === me ? 'ally' : ''].join(' ');
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

/** 角色主題色 */
export const themeOf = (charId: string) => CHAR_DEFS[charId]?.theme ?? '#c8963e';

// 卡牌文字裡的特殊詞條：上色＋底線（有說明的詞，長按放大卡牌時可以點開說明）
//   [詞] 一律當詞條；沒加中括號但和詞條同名的詞（例如「打擊 1 名單位」）也認得；【卡名】金色。
//   顏色分類、說明文字都在 engine/keywords.ts（共用）和角色檔的 keywords（角色專屬），這裡不用改。
let kwRegex: RegExp | null = null;
function kwPattern(): RegExp {
  if (!kwRegex) kwRegex = new RegExp(`\\[([^\\]]+)\\]|【([^】]+)】|(${keywordNames().join('|')})`, 'g');
  kwRegex.lastIndex = 0;
  return kwRegex;
}
/** 一個詞條的 HTML（word 已經過 esc） */
export function kwSpan(word: string, self?: string): string {
  const k = findKeyword(word);
  if (k && k.name === self) return `<span class="kw kw-${k.cat}">${word}</span>`; // 說明裡提到自己：不加底線
  if (!k) return `<span class="kw kw-chr">${word}</span>`;
  return `<span class="kw kw-${k.cat} kw-def" data-kw="${esc(k.name)}">${word}</span>`;
}
export function richText(text: string, self?: string): string {
  return esc(text).replace(kwPattern(), (_m, br?: string, card?: string, plain?: string) =>
    card !== undefined ? `<span class="kw kw-card">【${card}】</span>` : kwSpan(br ?? plain!, self));
}
/** 一段文字裡出現的詞條（有說明的、依出現順序、不重複） */
export function keywordsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(kwPattern())) {
    if (m[2] !== undefined) continue;
    const k = findKeyword(m[1] ?? m[3]);
    if (k && !out.includes(k.name)) out.push(k.name);
  }
  return out;
}

/** 卡牌文字長度分級：字越多字級越小，確保整段放得進文字框 */
function textSize(d: { text: string; discardText?: string }): string {
  const n = d.text.length + (d.discardText?.length ?? 0);
  return n > 70 ? 'xlong' : n > 42 ? 'long' : '';
}

/**
 * 卡面：卡圖、名稱條、文字框、費用（外框用卡牌所屬角色的主題色）。
 * 整個卡面帶 data-zoom，長按（或滑鼠右鍵）可以放大來看。
 */
export function cardInner(defId: string, cost?: number): string {
  const d = CARD_DEFS[defId];
  const c = cost ?? d.cost;
  return `<div class="face" style="--theme:${themeOf(d.charId)}" data-zoom="${defId}" data-zoom-cost="${c}">
    <div class="cost ${c < d.cost ? 'cheap' : ''}">${c}</div>
    <div class="art" style="--hue:${hue(defId)}"><span class="glyph">${esc(d.name[0])}</span><img src="${ASSET.card(defId)}"></div>
    <div class="cname">${esc(d.name)}</div>
    <div class="ctext ${textSize(d)}">${richText(d.text)}${d.discardText ? `<span class="dis"> ${kwSpan('(棄置時)')} ${richText(d.discardText)}</span>` : ''}</div>
  </div>`;
}

/** 卡背：角色專屬卡背 → 通用卡背 → 佔位花紋（圖片缺了就自動露出下一層）。rot＝橫放（敵方牌堆） */
export function backHtml(charId: string, rot = false): string {
  return `<div class="back ${rot ? 'rot' : ''}" style="--theme:${themeOf(charId)}"><img src="${ASSET.back}"><img src="${ASSET.backOf(charId)}"></div>`;
}

/** 我方牌堆：牌組在上、棄牌區在下 */
export function pilesHtml(u: Unit): string {
  const top = u.discard[u.discard.length - 1];
  const deckCls = u.deck.length === 0 ? 'empty' : u.deck.length < 5 ? 'thin' : '';
  const dis = top
    ? `<div class="pile discard" data-pile="discard" data-pile-unit="${u.id}"><div class="mini-art" style="--hue:${hue(top.defId)}">${esc(CARD_DEFS[top.defId].name[0])}<img src="${ASSET.card(top.defId)}"></div><div class="mini-name">${esc(CARD_DEFS[top.defId].name)}</div><div class="count">棄牌 <b>${u.discard.length}</b></div></div>`
    : `<div class="pile discard empty" data-pile="discard" data-pile-unit="${u.id}"><div class="count">棄牌 <b>0</b></div></div>`;
  return `<div class="piles s${u.slot}" data-piles="${u.id}">
    <div class="pile deck ${deckCls}" style="--theme:${themeOf(u.charId)}" data-pile="deck" data-pile-unit="${u.id}">${u.deck.length ? backHtml(u.charId) : ''}<div class="count">牌組 <b>${u.deck.length}</b></div></div>
    ${dis}
  </div>`;
}

/** 敵方的小牌堆 */
export function miniPilesHtml(u: Unit): string {
  const top = u.discard[u.discard.length - 1];
  return `<div class="minipiles s${u.slot}" data-piles="${u.id}">
    <div class="mp" data-pile="deck" data-pile-unit="${u.id}"><div style="--theme:${themeOf(u.charId)}">${u.deck.length ? backHtml(u.charId, true) : ''}</div>牌組 ${u.deck.length}</div>
    <div class="mp" data-pile="discard" data-pile-unit="${u.id}"><div class="dis ${top ? '' : 'empty'}" style="--hue:${top ? hue(top.defId) : 0}">${top ? `<img src="${ASSET.card(top.defId)}">` : ''}</div>棄牌 ${u.discard.length}</div>
  </div>`;
}

export function handHtml(g: Game, u: Unit, myPrompt: Prompt | null, myTurn: boolean, hidden?: Set<string>): string {
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
    const cls = ['card', playable ? 'playable' : '', selectable ? 'selectable' : '', ui.selected.has(c.uid) ? 'selected' : '', ui.picked?.uid === c.uid ? 'picked' : '', hidden?.has(c.uid) ? 'pending' : ''].join(' ');
    html += `<div class="${cls}" data-card="${c.uid}" data-owner="${u.id}" data-preview-card="${c.defId}" style="--x:${start + i * step}px;--y:${y}px;--rot:${rot}deg;z-index:${i + 1}">${cardInner(c.defId, g.cardCost(u, c.defId))}</div>`;
  });
  return html + `</div>`;
}

/** 中央帶：紀錄｜出牌展示區｜回合 */
export function bandHtml(st: GameState, g: Game, myPrompt: Prompt | null, myTurn: boolean, ro = false): string {
  const activeMine = st.active === me;
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
  if (st.winner !== null && !ro) { main = '對戰結束'; }
  else if (myPrompt?.kind === 'unit') { label = '請選擇'; main = esc(myPrompt.title); sub = '點選發光的角色'; }
  else if (myPrompt?.kind === 'cards') {
    const ok = ui.selected.size >= myPrompt.min && ui.selected.size <= myPrompt.max;
    label = '請選擇手牌'; main = esc(myPrompt.title);
    sub = `已選 ${ui.selected.size}${myPrompt.min === myPrompt.max ? ` / ${myPrompt.max}` : `（${myPrompt.min}～${myPrompt.max} 張）`}`;
    btns = `<button class="btn small" data-answer-cards ${ok ? '' : 'disabled'}>確定</button>`;
  } else if (myPrompt) { label = '請選擇'; main = esc(myPrompt.title); }
  else if (st.prompt && !ro) { main = `等待 ${esc(st.players[st.prompt.player].name)} 做選擇…`; mainCls = 'op'; }
  else if (myTurn && ui.picked) {
    const c = g.unit(ui.picked.unitId).hand.find(x => x.uid === ui.picked!.uid)!;
    const d = CARD_DEFS[c.defId];
    cardDef = c.defId; cardCls = 'me';
    label = '準備打出'; main = `${esc(g.unit(ui.picked.unitId).name)}：【${esc(d.name)}】`; sub = `花費 ${g.cardCost(g.unit(ui.picked.unitId), c.defId)} AP`;
    btns = `<button class="btn small" data-play-picked>打出</button><button class="btn small ghost" data-cancel-pick>取消</button>`;
  } else if (lastPlayed) {
    mainCls = rel(lastPlayed.side);
    main = `${lastPlayed.side === me ? '' : '對手的 '}${esc(lastPlayed.by)} 打出【${esc(CARD_DEFS[lastPlayed.defId].name)}】`;
    sub = myTurn ? '你的回合：點手牌出牌，或用角色旁的按鈕' : activeMine ? '你的回合' : `${esc(st.players[st.active].name)} 的回合…`;
  } else {
    main = activeMine ? '你的回合' : `${esc(st.players[st.active].name)} 的回合…`;
    mainCls = activeMine ? 'me' : 'op';
    sub = '打出的牌會顯示在這裡';
  }
  if (hoverDef && !myPrompt && !ui.picked && !ro) { cardDef = hoverDef; cardCls = 'me'; }
  const cardHtml = cardDef
    ? `<div class="showcard ${cardCls}" id="showcard" data-preview-card="${cardDef}">${cardInner(cardDef)}</div>`
    : `<div class="slot" id="showcard">出牌<br>展示區</div>`;

  return `<div class="band">
    <div class="logbox"><div class="head"><span>戰鬥紀錄</span><button class="btn ghost small" data-act="fulllog">展開</button></div>${lines}</div>
    <div class="show">${cardHtml}<div class="info"><span class="label">${label}</span><span class="main ${mainCls}">${main}</span>${sub ? `<span class="sub">${sub}</span>` : ''}${btns ? `<div class="btns">${btns}</div>` : ''}</div></div>
    <div class="turn">
      <div class="t1"><span>第 ${st.turn} 回合</span><span class="who ${rel(st.active)}">${st.active === me ? '你的回合' : esc(st.players[st.active].name)}</span></div>
      <button class="btn endturn ${myTurn && !hasOtherActions(g) ? 'glow' : ''}" data-end ${myTurn ? '' : 'disabled'}>結束回合</button>
      <button class="btn ghost small" data-act="menu">選單</button>
    </div>
  </div>`;
}

/** 除了結束回合以外，還有沒有能做的事（決定結束回合按鈕要不要閃） */
function hasOtherActions(g: Game): boolean {
  return legalActions(g, me).some(a => a.type !== 'endTurn');
}

export function modalHtml(p: Prompt): string {
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

export function gameOverHtml(st: GameState): string {
  const w = st.winner;
  const text = w === 'draw' ? '平手' : w === me ? '勝利' : '敗北';
  const cls = w === me ? 'win' : 'lose';
  return `<div class="gameover"><h1 class="${cls}">${text}</h1>
    <div class="row2"><button class="btn" data-act="rematch">再來一局</button><button class="btn ghost" data-act="reselect">重新選角</button><button class="btn ghost" data-act="lobby">回到大廳</button></div></div>`;
}
