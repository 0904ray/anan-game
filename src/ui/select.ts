// 選角畫面：從角色登記表自動列出所有角色（新角色登記後會自動出現，不用改這裡）
import { CARD_DEFS, roster, isValidTeam, CHAR_DEFS, type Team } from '../engine';
import { ALLOW_SAME_CHAR_IN_TEAM } from '../config';
import { ASSET, esc, hue, stage } from './dom';
import { richText, kwSpan, themeOf } from './render';

export interface SelectRequest {
  /** 標題旁顯示是誰在選，例如「玩家二 選角」 */
  who: string;
  /** 連線模式：確認後要等對手 */
  online?: boolean;
  onConfirm(team: Team): void;
}

let req: SelectRequest | null = null;
let team: [string | null, string | null] = [null, null];
let focus: string | null = null;
let locked = false; // 已確認，等待對手
let status = '';

export const isSelecting = () => req !== null;

export function showSelect(r: SelectRequest) {
  req = r;
  team = [null, null];
  focus = roster()[0]?.id ?? null;
  locked = false;
  status = r.online ? '選好兩隻角色後按確認，對手看不到你選了誰' : '';
  render();
}

export function closeSelect() { req = null; }

export function setSelectStatus(text: string) {
  status = text;
  const el = stage.querySelector('.sel-status');
  if (el) el.textContent = text;
}

// ---------------------------------------------------------------------
// 畫面
// ---------------------------------------------------------------------
function portrait(charId: string, cls = ''): string {
  const c = CHAR_DEFS[charId];
  return `<div class="sel-art ${cls}" style="--hue:${hue(charId)}"><span class="initial">${esc(c.name[0])}</span><img src="${ASSET.char(charId)}"></div>`;
}

function cardHtml(id: string): string {
  const c = CHAR_DEFS[id];
  const slot = team.indexOf(id);
  const cls = ['sel-card', focus === id ? 'focus' : '', slot >= 0 ? 'picked' : ''].join(' ');
  return `<button class="${cls}" data-sel-char="${id}">
    ${portrait(id)}
    ${slot >= 0 ? `<span class="sel-badge">${slot === 0 ? '左' : '右'}</span>` : ''}
    <span class="sel-name">${esc(c.name)}</span>
    <span class="sel-title">${esc(c.title)}</span>
    <span class="sel-stats">HP ${c.hp}｜AP ${c.ap}｜TP ${c.tp}｜${c.atText ?? `AT ${c.at}`}</span>
  </button>`;
}

function detailHtml(id: string | null): string {
  if (!id) return '';
  const c = CHAR_DEFS[id];
  const deck = c.deck.map(([defId, n]) => {
    const d = CARD_DEFS[defId];
    return `<div class="sel-deckrow" data-zoom="${defId}"><span class="cost">${d.cost}</span><div><b>${esc(d.name)}</b> ×${n}<div class="txt">${d.drawText ? `<span class="drw">${kwSpan('（抽出時）')}${richText(d.drawText)}</span> ` : ''}${richText(d.text)}${d.discardText ? `<span class="dis">${kwSpan('（棄置時）')}${richText(d.discardText)}</span>` : ''}</div></div></div>`;
  }).join('');
  const total = c.deck.reduce((s, [, n]) => s + n, 0);
  return `<div style="--theme:${themeOf(id)}">
    <h3>${esc(c.name)}</h3>
    <div class="tag">${esc(c.title)}</div>
    <div class="sel-statline">HP ${c.hp}　AP ${c.ap}　TP ${c.tp}　${c.atText ? `${c.atText} × AP ${c.atkCost}` : c.noAttack ? `AT ${c.at}（不能普攻）` : `AT ${c.at} × AP ${c.atkCost}`}</div>
    <h4>能力</h4>
    ${c.abilities.map((a, i) => `<div class="ab"><b>${i + 1}. ${esc(a.name)}</b>${a.active ? '<span class="act">主動</span>' : ''}：${richText(a.text)}</div>`).join('')}
    <h4>牌組（${total} 張）</h4>
    ${deck}
    <div class="lore">${esc(c.lore)}</div></div>`;
}

function slotHtml(i: 0 | 1): string {
  const id = team[i];
  const label = i === 0 ? '左邊' : '右邊';
  if (!id) return `<div class="sel-slot empty" data-sel-slot="${i}"><span class="lbl">${label}</span><span class="hint">點上面的角色加入</span></div>`;
  return `<div class="sel-slot" data-sel-slot="${i}">${portrait(id, 'mini')}<div><span class="lbl">${label}</span><b>${esc(CHAR_DEFS[id].name)}</b><span class="hint">點這裡移除</span></div></div>`;
}

function render() {
  if (!req) return;
  const ok = isValidTeam(team, ALLOW_SAME_CHAR_IN_TEAM) && !locked;
  stage.innerHTML = `
    <img class="bg-img" src="${ASSET.lobby}">
    <div class="select ${locked ? 'locked' : ''}">
      <div class="sel-head"><h2>選擇隊伍</h2><span class="who">${esc(req.who)}</span><span class="grow"></span><button class="btn ghost small" data-act="lobby">回到大廳</button></div>
      <div class="sel-grid">${roster().map(c => cardHtml(c.id)).join('')}</div>
      <div class="sel-detail">${detailHtml(focus)}</div>
      <div class="sel-team">
        ${slotHtml(0)}
        <button class="btn ghost" data-sel="swap" ${team[0] && team[1] && !locked ? '' : 'disabled'}>⇄ 交換左右</button>
        ${slotHtml(1)}
        <div class="sel-right">
          <button class="btn sel-confirm" data-sel="confirm" ${ok ? '' : 'disabled'}>${locked ? '已確認' : '確認出戰'}</button>
          <div class="sel-status">${esc(status)}</div>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// 點擊（由 input.ts 轉過來）。處理了就回傳 true
// ---------------------------------------------------------------------
export function handleSelectClick(t: HTMLElement): boolean {
  if (!req) return false;
  const charEl = t.closest('[data-sel-char]') as HTMLElement | null;
  const slotEl = t.closest('[data-sel-slot]') as HTMLElement | null;
  const btn = t.closest('[data-sel]') as HTMLElement | null;
  if (!charEl && !slotEl && !btn) return false;
  if (locked) return true;

  if (charEl) {
    const id = charEl.dataset.selChar!;
    focus = id;
    const already = team.includes(id);
    const empty = team.indexOf(null);
    if (empty >= 0 && (!already || ALLOW_SAME_CHAR_IN_TEAM)) team[empty] = id;
    else if (already && !ALLOW_SAME_CHAR_IN_TEAM && empty >= 0) status = '同一隊不能選兩隻一樣的角色';
  } else if (slotEl) {
    const i = Number(slotEl.dataset.selSlot) as 0 | 1;
    if (team[i]) { focus = team[i]; team[i] = null; }
  } else if (btn?.dataset.sel === 'swap') {
    team = [team[1], team[0]];
  } else if (btn?.dataset.sel === 'confirm') {
    if (!isValidTeam(team, ALLOW_SAME_CHAR_IN_TEAM)) return true;
    const picked: Team = [team[0]!, team[1]!];
    const r = req;
    if (r.online) { locked = true; status = '已送出，等待對手選角…'; render(); }
    else req = null;
    r.onConfirm(picked);
    return true;
  }
  render();
  return true;
}

/** 電腦／滑鼠：移到角色上就顯示說明 */
export function handleSelectHover(t: HTMLElement) {
  if (!req) return;
  const el = t.closest('[data-sel-char]') as HTMLElement | null;
  if (!el || el.dataset.selChar === focus) return;
  focus = el.dataset.selChar!;
  const d = stage.querySelector('.sel-detail');
  if (d) d.innerHTML = detailHtml(focus);
  stage.querySelectorAll('.sel-card').forEach(x => x.classList.toggle('focus', (x as HTMLElement).dataset.selChar === focus));
}
