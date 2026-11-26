import type { GameState, PlayerIdx } from './types';

/** 給某位玩家看的畫面資料：藏起對手手牌和雙方牌組順序 */
export function viewFor(state: GameState, viewer: PlayerIdx | 'all'): GameState {
  const s: GameState = JSON.parse(JSON.stringify(state));
  for (const p of s.players) {
    for (const u of p.units) {
      // 自己的牌組內容本來就知道（固定牌組），但順序要藏起來；對手的牌組全藏
      if (viewer === 'all' || p.idx === viewer) u.deck = [...u.deck].sort((a, b) => a.defId.localeCompare(b.defId)).map((c, i) => ({ uid: 'd' + u.id + i, defId: c.defId }));
      else u.deck = u.deck.map((_, i) => ({ uid: 'd' + u.id + i, defId: 'hidden' }));
      if (viewer !== 'all' && p.idx !== viewer) u.hand = u.hand.map((_, i) => ({ uid: 'h' + u.id + i, defId: 'hidden' }));
      // 移出牌局的牌：對手只看到張數，看不到是哪幾張
      if (viewer === 'all' || p.idx === viewer) u.removed = [...u.removed].sort((a, b) => a.defId.localeCompare(b.defId)).map((c, i) => ({ uid: 'r' + u.id + i, defId: c.defId }));
      else u.removed = u.removed.map((_, i) => ({ uid: 'r' + u.id + i, defId: 'hidden' }));
    }
  }
  return s;
}
