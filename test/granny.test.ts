import { describe, it, expect } from 'vitest';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const TEAM: Team = ['savanna', 'granny'];
const newGame = (seed = 1) => make(TEAM, seed);

describe('葛蘭妮', () => {
  it('基本數值：HP45 AP6 TP5 AT1，普攻花 2 AP', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    expect([gr.maxHp, gr.apMax, gr.tpMax, gr.at, gr.atkCost]).toEqual([45, 6, 5, 1, 2]);
    expect(gr.name).toBe('葛蘭妮');
    expect(g.apply(0, { type: 'attack', unitId: gr.id }).ok).toBe(true);
    if (g.state.prompt) ans(g, 'p1u0');
    expect(gr.ap).toBe(0);
  });

  it('我方棄牌：暴食不足 3 時自動 +1 暴食；薩凡娜同時 +1 財富', () => {
    const g = newGame();
    const [sav, gr] = g.state.players[0].units;
    const uid = give(g, gr.id, 'gra_blood');
    g.apply(0, { type: 'play', unitId: gr.id, cardUid: uid });
    ans(g, [gr.hand[0].uid]); // 棄 1 張
    while (g.state.prompt) ans(g, false);
    expect(gr.counters.gluttony).toBe(2); // 暴食血統 +1，棄牌 +1
    expect(sav.counters.wealth).toBe(1);
  });

  it('我方棄牌：暴食 ≥ 3 可以吞噬那張牌（AT+1、回 1 HP、抽 1）', () => {
    const g = newGame();
    const [sav, gr] = g.state.players[0].units;
    gr.counters.gluttony = 3;
    gr.hp = 40;
    sav.hand = [];
    const stock = give(g, sav.id, 'sav_stock');
    give(g, sav.id, 'sav_arms');
    const handBefore = gr.hand.length;
    g.apply(0, { type: 'play', unitId: sav.id, cardUid: stock });
    // 薩凡娜抽 1 張後選棄軍火交易
    const arms = sav.hand.find(c => c.defId === 'sav_arms')!.uid;
    ans(g, [arms]);
    expect(g.state.prompt?.kind).toBe('option');
    ans(g, 1); // 吞噬
    while (g.state.prompt) ans(g, false);
    expect(gr.under.map(c => c.defId)).toEqual(['sav_arms']);
    expect(g.effAt(gr)).toBe(2);
    expect(gr.hp).toBe(41);
    expect(gr.hand.length).toBe(handBefore + 1);
    expect(gr.counters.gluttony).toBe(0);
    expect(sav.discard.some(c => c.defId === 'sav_arms')).toBe(false);
  });

  it('打擊時回 1 HP；飲血回復造成的傷害', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    gr.hp = 30;
    gr.ap = 6;
    gr.under = [{ uid: 'x1', defId: 'sav_stock' }, { uid: 'x2', defId: 'sav_stock' }]; // AT 3
    const d = give(g, gr.id, 'gra_drink');
    g.apply(0, { type: 'play', unitId: gr.id, cardUid: d });
    if (g.state.prompt) ans(g, 'p1u0');
    // 傷害 3 → 回 3，加上打擊回 1
    expect(gr.hp).toBe(34);
    expect(gr.ap).toBe(1);
  });

  it('吞噬 ≥ 4 張時：飲血／食肉 -3 AP、噬骨 -4 AP', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    expect(g.cardCost(gr, 'gra_drink')).toBe(5);
    gr.under = [1, 2, 3, 4].map(i => ({ uid: 'u' + i, defId: 'gra_blood' }));
    expect(g.cardCost(gr, 'gra_drink')).toBe(2);
    expect(g.cardCost(gr, 'gra_meat')).toBe(2);
    expect(g.cardCost(gr, 'gra_bone')).toBe(3);
  });

  it('使用吞噬的牌：進棄牌區，+1 暴食', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    gr.under = [{ uid: 'e1', defId: 'gra_blood' }];
    expect(g.apply(0, { type: 'playUnder', unitId: gr.id, cardUid: 'e1' }).ok).toBe(true);
    while (g.state.prompt) ans(g, g.state.prompt.kind === 'cards' ? [g.state.prompt.cardUids[0]] : 0);
    expect(gr.under.length).toBe(0);
    expect(gr.discard.some(c => c.uid === 'e1')).toBe(true);
    // 暴食血統 +1、棄牌 +1、反芻 +1
    expect(gr.counters.gluttony).toBe(3);
  });

  it('消化：花 1 暴食，吞噬的牌進棄牌區，AT 永久 +X、回 X HP', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    gr.hp = 30;
    gr.counters.gluttony = 1;
    gr.under = [1, 2, 3].map(i => ({ uid: 'u' + i, defId: 'gra_blood' }));
    expect(g.effAt(gr)).toBe(4);
    expect(g.apply(0, { type: 'ability', unitId: gr.id, abilityId: 'a5' }).ok).toBe(true);
    expect(gr.under.length).toBe(0);
    expect(g.effAt(gr)).toBe(4); // 1 + 永久 3
    expect(gr.hp).toBe(33);
    expect(gr.discard.length).toBe(3);
  });

  it('噬骨：打擊 + -1 TP，可花 3 暴食重複；目標瀕死時可花 6 暴食處決', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    const [t0, t1] = g.state.players[1].units;
    gr.ap = 7;
    gr.counters.gluttony = 9;
    t0.hp = 1; // 下一口就瀕死
    t1.spBonus = -5; // 讓 t0 成為唯一目標
    const b = give(g, gr.id, 'gra_bone');
    g.apply(0, { type: 'play', unitId: gr.id, cardUid: b });
    expect(t0.life).toBe('dying');
    expect(g.state.prompt?.kind).toBe('confirm'); // 處決？
    ans(g, true);
    expect(t0.life).toBe('dead');
    expect(gr.counters.gluttony).toBe(3);
  });

  it('食肉：打擊後可選吞噬手牌或 +3 暴食', () => {
    const g = newGame();
    const gr = g.unit('p0u1');
    gr.ap = 5;
    const m = give(g, gr.id, 'gra_meat');
    g.apply(0, { type: 'play', unitId: gr.id, cardUid: m });
    if (g.state.prompt?.kind === 'unit') ans(g, 'p1u0');
    expect(g.state.prompt?.kind).toBe('option');
    ans(g, 1); // +3 暴食
    expect(gr.counters.gluttony).toBe(3);
  });
});

describe('盤中餐從隊友手牌吞噬', () => {
  it('先選角色，再選那個角色的手牌', () => {
    const g = newGame();
    const [sav, gr] = g.state.players[0].units;
    gr.ap = 3; gr.counters.gluttony = 1;
    const meal = give(g, gr.id, 'gra_meal');
    const target = sav.hand[0].uid;
    const savBefore = sav.hand.length;
    g.apply(0, { type: 'play', unitId: gr.id, cardUid: meal });
    expect(g.state.prompt?.kind).toBe('unit');
    ans(g, sav.id);
    expect(g.state.prompt?.kind).toBe('cards');
    ans(g, [target]);
    expect(gr.under.map(c => c.uid)).toEqual([target]);
    expect(sav.hand.length).toBe(savBefore - 1);
  });
});
