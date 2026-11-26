import './chars/savanna';
import { Game } from './game';
import { CARD_DEFS, CHAR_DEFS } from './defs';
import type { Action, Answer, GameState, PlayerIdx, Prompt } from './types';

export { Game, CARD_DEFS, CHAR_DEFS };
export type * from './types';

/** 給某位玩家看的畫面資料：藏起對手手牌和雙方牌組順序 */
export function viewFor(state: GameState, viewer: PlayerIdx | 'all'): GameState {
  const s: GameState = JSON.parse(JSON.stringify(state));
  for (const p of s.players) {
    for (const u of p.units) {
      // 自己的牌組內容本來就知道（固定牌組），但順序要藏起來；對手的牌組全藏
      if (viewer === 'all' || p.idx === viewer) u.deck = [...u.deck].sort((a, b) => a.defId.localeCompare(b.defId)).map((c, i) => ({ uid: 'd' + u.id + i, defId: c.defId }));
      else u.deck = u.deck.map((_, i) => ({ uid: 'd' + u.id + i, defId: 'hidden' }));
      if (viewer !== 'all' && p.idx !== viewer) u.hand = u.hand.map((c, i) => ({ uid: 'h' + u.id + i, defId: 'hidden' }));
    }
  }
  return s;
}

/** 列出目前可做的操作（電腦和畫面都會用到） */
export function legalActions(g: Game, player: PlayerIdx): Action[] {
  const st = g.state;
  if (st.winner !== null || st.prompt || st.active !== player) return [];
  const out: Action[] = [];
  for (const u of st.players[player].units) {
    for (const c of u.hand) out.push({ type: 'play', unitId: u.id, cardUid: c.uid });
    out.push({ type: 'attack', unitId: u.id }, { type: 'advance', unitId: u.id }, { type: 'rescue', unitId: u.id });
    for (const ab of CHAR_DEFS[u.charId].abilities) if (ab.active) out.push({ type: 'ability', unitId: u.id, abilityId: ab.id });
  }
  out.push({ type: 'endTurn' });
  return out.filter(a => g.checkAction(player, a) === null);
}

/** 隨機產生一個合法答案 */
export function randomAnswer(p: Prompt, rnd: () => number): Answer {
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  switch (p.kind) {
    case 'unit': return pick(p.unitIds);
    case 'confirm': return rnd() < 0.7;
    case 'option': return Math.floor(rnd() * p.options.length);
    case 'number': return p.min + Math.floor(rnd() * (p.max - p.min + 1));
    case 'cards': {
      const n = p.min + Math.floor(rnd() * (p.max - p.min + 1));
      const pool = [...p.cardUids];
      const res: string[] = [];
      for (let i = 0; i < n; i++) res.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      return res;
    }
  }
}

/** 簡單電腦：隨機挑合法操作，偏好先把事情做完再結束回合 */
export function botStep(g: Game, player: PlayerIdx, rnd: () => number = Math.random): Action | null {
  const st = g.state;
  if (st.winner !== null) return null;
  if (st.prompt) return st.prompt.player === player ? { type: 'answer', value: randomAnswer(st.prompt, rnd) } : null;
  if (st.active !== player) return null;
  const acts = legalActions(g, player);
  const nonEnd = acts.filter(a => a.type !== 'endTurn');
  if (!nonEnd.length || rnd() < 0.08) return { type: 'endTurn' };
  // 優先：攻擊 > 出牌 > 其他
  const attacks = nonEnd.filter(a => a.type === 'attack');
  if (attacks.length && rnd() < 0.6) return attacks[Math.floor(rnd() * attacks.length)];
  const plays = nonEnd.filter(a => a.type === 'play');
  if (plays.length && rnd() < 0.8) return plays[Math.floor(rnd() * plays.length)];
  return nonEnd[Math.floor(rnd() * nonEnd.length)];
}
