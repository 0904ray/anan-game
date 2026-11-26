// 測試共用工具
import { expect } from 'vitest';
import { Game, botStep, viewFor, type PlayerIdx } from '../src/engine';

export type Team = [string, string];

/** 建立固定種子、固定先攻的對局（預設雙方都是 team） */
export function newGame(team: Team, seed = 1, other: Team = team): Game {
  return Game.create({ seed, names: ['A', 'B'], chars: [team, other], first: 0 });
}

/** 回答目前的選擇視窗（一定要合法） */
export function answer(g: Game, value: any) {
  const r = g.apply(g.state.prompt!.player, { type: 'answer', value });
  expect(r.ok, r.error).toBe(true);
}

/** 塞一張指定的牌到某角色手上，回傳它的 uid */
export function give(g: Game, unitId: string, defId: string): string {
  const c = { uid: 'test' + (++g.state.uidCounter), defId };
  g.unit(unitId).hand.push(c);
  return c.uid;
}

/** 可重現的亂數 */
export function seeded(seed: number) {
  let r = seed * 7919;
  return () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
}

/**
 * 讓兩個隨機電腦打 n 場，每一步都檢查狀態合理（HP、TP、AP、計數器不為負、雙方牌總數不變）。
 * 回傳 [玩家0勝, 玩家1勝, 平手或未完]
 */
export function simulate(teams: [Team, Team], n: number, deckSize: (p: PlayerIdx) => number): [number, number, number] {
  const wins: [number, number, number] = [0, 0, 0];
  for (let seed = 1; seed <= n; seed++) {
    const g = Game.create({ seed, names: ['A', 'B'], chars: teams });
    const rnd = seeded(seed);
    let steps = 0;
    while (g.state.winner === null && g.state.turn < 200) {
      const who = g.actor()!;
      const a = botStep(g, who, rnd)!;
      const res = g.apply(who, a);
      if (!res.ok) throw new Error(`seed ${seed}: ${res.error} ${JSON.stringify(a)}`);
      for (const p of g.state.players) {
        let total = 0;
        for (const u of p.units) {
          total += u.deck.length + u.hand.length + u.discard.length + u.playing.length + u.under.length + u.removed.length;
          if (u.hp < 0 || u.hp > u.maxHp) throw new Error(`seed ${seed}: ${u.id} hp ${u.hp}`);
          if (u.tp < 0 || u.tp > u.tpMax) throw new Error(`seed ${seed}: ${u.id} tp ${u.tp}`);
          if (u.ap < 0) throw new Error(`seed ${seed}: ${u.id} ap ${u.ap}`);
          for (const [k, v] of Object.entries(u.counters)) if (v < 0) throw new Error(`seed ${seed}: ${u.id} ${k} ${v}`);
        }
        if (total !== deckSize(p.idx)) throw new Error(`seed ${seed}: player ${p.idx} 牌總數 ${total}`);
      }
      if (++steps > 30000) throw new Error('卡住了 seed ' + seed);
    }
    wins[g.state.winner === null || g.state.winner === 'draw' ? 2 : g.state.winner]++;
    // 畫面資料要能序列化，而且對手手牌要藏起來
    const v = viewFor(g.state, 0);
    if (!v.players[1].units.every(u => u.hand.every(c => c.defId === 'hidden'))) throw new Error('對手手牌沒藏好');
    JSON.stringify(v);
  }
  return wins;
}
