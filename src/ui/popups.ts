// 頁內彈出視窗：角色說明、完整紀錄、牌堆內容、吞噬牌堆、選單
import { CARD_DEFS, CHAR_DEFS, type Action } from '../engine';
import { esc, stage } from './dom';
import { view, me, rel, liveGame } from './state';
import { cardInner, richText, themeOf } from './render';

// 頁內彈出視窗（角色說明、完整紀錄、棄牌區內容、選單）
export function popup(inner: string) {
  stage.querySelector('.popup-bg')?.remove();
  const el = document.createElement('div');
  el.className = 'modal-bg popup-bg';
  el.innerHTML = `<div class="modal">${inner}<div class="row2"><button class="btn ghost" data-act="close-popup">關閉</button></div></div>`;
  stage.appendChild(el);
  const log = el.querySelector('.fulllog');
  if (log) log.scrollTop = log.scrollHeight;
}
export function showCharSheet(unitId: string) {
  const u = liveGame().unit(unitId);
  const c = CHAR_DEFS[u.charId];
  popup(`<div class="charsheet" style="--theme:${themeOf(u.charId)}">
    <h3>${esc(u.name)}</h3><div class="tag">${esc(c.title)}　HP ${c.hp}｜AP ${c.ap}｜TP ${c.tp}｜AT ${c.at} × AP ${c.atkCost}</div>
    ${c.abilities.map((a, i) => `<div class="ab"><b>${i + 1}. ${esc(a.name)}</b>${a.active ? '<span class="act">主動</span>' : ''}：${richText(a.text)}</div>`).join('')}
    <div class="lore">${esc(c.lore)}</div></div>`);
}
export function showFullLog() {
  const st = view!;
  popup(`<h2>戰鬥紀錄</h2><div class="fulllog">${st.log.map(l => {
    const cls = l.text.startsWith('——') ? 'sys' : l.side === undefined ? '' : rel(l.side);
    return `<div class="${cls}">${esc(l.text)}</div>`;
  }).join('')}</div>`);
}
export function showPile(unitId: string, kind: 'deck' | 'discard') {
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
export function showUnder(unitId: string) {
  const g = liveGame();
  const u = g.unit(unitId);
  const c = CHAR_DEFS[u.charId];
  const myTurn = view!.winner === null && !view!.prompt && view!.active === me;
  const items = u.under.map(card => {
    const a: Action = { type: 'playUnder', unitId: u.id, cardUid: card.uid };
    const err = u.owner === me && myTurn ? g.checkAction(me, a) : '不是你的回合';
    const btn = u.owner === me ? `<button class="act-btn" data-action='${esc(JSON.stringify(a))}' ${err ? `disabled title="${esc(err)}"` : ''}>使用</button>` : '';
    return `<div class="underitem"><div class="showcard me">${cardInner(card.defId, g.cardCost(u, card.defId))}</div>${btn}</div>`;
  }).join('');
  popup(`<h2>${esc(u.name)} 的${c.underName ?? '下方'}牌堆　${u.under.length} 張（每張 AT +1）</h2>
    <div class="underlist">${items || '<div class="item">還沒有吞噬任何牌</div>'}</div>
    ${u.owner === me ? '<div class="hint2">使用吞噬的牌：照卡面費用付 AP，用完進棄牌區，+1 暴食</div>' : ''}`);
}

export function showMenu() {
  popup(`<h2>離開這場對戰，回到大廳？</h2><div class="row2"><button class="btn" data-act="lobby">回到大廳</button></div>`);
}
