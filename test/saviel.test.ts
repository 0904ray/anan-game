import { describe, it, expect } from 'vitest';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const TEAM: Team = ['saviel', 'granny'];
const newGame = (seed = 1) => make(TEAM, seed);

/** 對指定目標發動一次主動攻擊 */
function attack(g: ReturnType<typeof newGame>, unitId: string, targetId: string) {
  const r = g.apply(0, { type: 'attack', unitId });
  expect(r.ok, r.error).toBe(true);
  if (g.state.prompt) ans(g, targetId);
}

describe('薩維爾', () => {
  it('基本數值：HP40 AP6 TP6 AT1，主動攻擊 0 AP', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    expect([s.maxHp, s.apMax, s.tpMax, s.at, s.atkCost]).toEqual([40, 6, 6, 1, 0]);
    expect(s.name).toBe('薩維爾');
    // 沒有焰能就不能主動攻擊
    expect(g.apply(0, { type: 'attack', unitId: s.id }).ok).toBe(false);
  });

  it('焰能：每 1 層可主動攻擊 1 次，攻擊不花 AP、每次消耗 1 層', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.counters.flame = 3;
    s.ap = 6;
    const hp0 = t.hp;
    const tp0 = t.tp;
    for (let i = 0; i < 3; i++) attack(g, s.id, t.id);
    expect(s.counters.flame).toBe(0);
    expect(s.ap).toBe(6); // 不花 AP
    expect(t.hp).toBe(hp0 - 3);
    expect(t.tp).toBe(tp0); // 直擊不扣 TP
    expect(g.apply(0, { type: 'attack', unitId: s.id }).ok).toBe(false);
  });

  it('每回合首次主動攻擊抽 1 張牌，第二次不再抽', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.counters.flame = 2;
    s.hand = [];
    attack(g, s.id, t.id);
    expect(s.hand.length).toBe(1);
    attack(g, s.id, t.id);
    expect(s.hand.length).toBe(1);
  });

  it('連擊 3、4、5：下一次攻擊 AT +1（不可疊加）', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.counters.combo = 2;
    s.counters.flame = 2;
    const hp0 = t.hp;
    attack(g, s.id, t.id); // 第 3 次攻擊
    expect(s.counters.combo).toBe(3);
    expect(s.counters.boost).toBe(1);
    expect(g.effAt(s)).toBe(2);
    attack(g, s.id, t.id); // 第 4 次攻擊吃到 +1
    expect(t.hp).toBe(hp0 - 1 - 2);
  });

  it('連擊 6：本次傷害加倍，且視為直傷（不扣 TP）', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u1');
    s.counters.combo = 5;
    s.counters.boost = 0;
    s.counters.flame = 1;
    const hp0 = t.hp;
    const tp0 = t.tp;
    attack(g, s.id, t.id);
    expect(t.hp).toBe(hp0 - 2); // AT 1 → ×2
    expect(t.tp).toBe(tp0);
    expect(s.counters.combo).toBe(6);
  });

  it('瞬焰：+1 焰能、抽 1 張；連擊 1、2 時下一次攻擊 +1 AT（不可疊加）', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    s.hand = [];
    s.ap = 1;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_instant') });
    expect(s.counters.flame).toBe(1);
    expect(s.hand.length).toBe(1);
    expect(s.counters.boost).toBe(0); // 連擊 0 不給

    s.counters.combo = 1;
    s.ap = 1;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_instant') });
    expect(s.counters.boost).toBe(1);

    s.counters.combo = 2;
    s.ap = 1;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_instant') });
    expect(s.counters.boost).toBe(1); // 不可疊加
  });

  it('速拔：打擊是直擊；連擊 1 時再打一次並使目標下回合 -1 AT', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.ap = 1;
    s.counters.flame = 5;
    const hp0 = t.hp;
    const tp0 = t.tp;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_draw') });
    ans(g, t.id);
    expect(t.hp).toBe(hp0 - 2); // 兩次直擊
    expect(t.tp).toBe(tp0); // 不扣 TP
    expect(t.at).toBe(0); // -1 AT
    expect(t.counters.atDown).toBe(1);
    expect(s.counters.combo).toBe(2);
  });

  it('速拔：不是連擊 1 時只有一次打擊', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.ap = 1;
    s.counters.flame = 5;
    s.counters.combo = 3;
    const hp0 = t.hp;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_draw') });
    ans(g, t.id);
    expect(t.hp).toBe(hp0 - 1);
    expect(t.at).toBe(1);
    expect(s.counters.combo).toBe(4);
  });

  it('裝填：+2 焰能、抽 2 張；連擊 0 時再 +1 焰能', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    s.hand = [];
    s.ap = 2;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_load') });
    expect(s.counters.flame).toBe(3);
    expect(s.hand.length).toBe(2);

    s.counters.combo = 1;
    s.ap = 2;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_load') });
    expect(s.counters.flame).toBe(5); // 只 +2
  });

  it('火神的通緝令：被標記的單位受到直擊時額外 1 直傷；連擊 0 時 +1 AP', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.ap = 3;
    s.counters.flame = 2;
    const hp0 = t.hp;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_wanted') });
    ans(g, t.id);
    expect(t.counters.wanted).toBe(1);
    expect(s.ap).toBe(1); // 3 - 3 + 1
    attack(g, s.id, t.id);
    expect(t.hp).toBe(hp0 - 2); // 1 直擊 + 1 通緝令直傷
  });

  it('火輪擊：造成焰能數 ×2 的直擊，隨後焰能清空', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u1');
    s.ap = 3;
    s.counters.flame = 4;
    const hp0 = t.hp;
    const tp0 = t.tp;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_ring') });
    ans(g, t.id);
    expect(t.hp).toBe(hp0 - 8);
    expect(t.tp).toBe(tp0);
    expect(s.counters.flame).toBe(0);
  });

  it('薩達莉亞的餘燼：+5 AP，本回合每次攻擊額外 1 直傷', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.ap = 6;
    s.counters.flame = 2;
    const hp0 = t.hp;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_ember') });
    expect(s.ap).toBe(5);
    attack(g, s.id, t.id);
    expect(t.hp).toBe(hp0 - 2);
  });

  it('回合結束清空焰能、連擊與通緝令標記；下一個自己回合回復 -1 AT', () => {
    const g = newGame();
    const s = g.unit('p0u0');
    const t = g.unit('p1u0');
    s.counters.flame = 3;
    s.counters.combo = 2;
    s.counters.boost = 1;
    t.counters.wanted = 1;
    t.at = 0;
    t.counters.atDown = 1;
    // 排入回合結束清理
    s.ap = 1;
    g.apply(0, { type: 'play', unitId: s.id, cardUid: give(g, s.id, 'svi_instant') });
    g.apply(0, { type: 'endTurn' });
    expect(s.counters.flame).toBe(0);
    expect(s.counters.combo).toBe(0);
    expect(t.counters.wanted).toBe(0);
    expect(t.at).toBe(0);
    g.apply(1, { type: 'endTurn' }); // 回到薩維爾的回合
    expect(t.at).toBe(1);
    expect(t.counters.atDown).toBe(0);
  });
});
