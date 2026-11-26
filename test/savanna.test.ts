import { describe, it, expect } from 'vitest';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const SAV: Team = ['savanna', 'savanna'];
const newGame = (seed = 1) => make(SAV, seed);

describe('薩凡娜', () => {

  it('棄牌 +1 財富（我方任一單位棄牌，兩隻薩凡娜都 +1）', () => {
    const g = newGame();
    const [a0, a1] = g.state.players[0].units;
    const uid = give(g, a0.id, 'sav_stock');
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: uid });
    // 抽 1 後選 1 張棄
    expect(g.state.prompt?.kind).toBe('cards');
    const toDiscard = a0.hand.find(c => c.defId !== 'sav_stock' && c.defId !== 'sav_arms')?.uid ?? a0.hand[0].uid;
    ans(g, [toDiscard]);
    while (g.state.prompt) ans(g, false);
    expect(a0.counters.wealth).toBe(1);
    expect(a1.counters.wealth).toBe(1);
  });

  it('軍火交易被棄置時可 [收買2] 打擊 2 次，並觸發「首次收買隊友抽牌」', () => {
    const g = newGame();
    const [a0, a1] = g.state.players[0].units;
    a0.hand = [];
    a0.counters.wealth = 1; // 棄牌後 +1 → 2
    const arms = give(g, a0.id, 'sav_arms');
    const stock = give(g, a0.id, 'sav_stock');
    const mateHand = a1.hand.length;
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: stock });
    // 抽 1 張後選棄軍火交易
    ans(g, [arms]);
    expect(g.state.prompt?.kind).toBe('confirm'); // 收買2？
    ans(g, true);
    if (g.state.prompt?.kind === 'unit') ans(g, 'p1u0');
    const hpSum = g.state.players[1].units.reduce((s, u) => s + u.hp, 0);
    expect(hpSum).toBe(88);
    expect(a1.hand.length).toBe(mateHand + 1);
  });

  it('一本萬利：棄置所有手牌，隊友抽 2', () => {
    const g = newGame();
    const [a0, a1] = g.state.players[0].units;
    a0.ap = 4;
    a0.hand = [];
    const j = give(g, a0.id, 'sav_jackpot');
    give(g, a0.id, 'sav_norefund');
    give(g, a0.id, 'sav_norefund');
    const mate = a1.hand.length;
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: j });
    expect(a0.hand.length).toBe(0);
    expect(a0.counters.wealth).toBe(2);
    expect(a1.hand.length).toBe(mate + 2);
  });

  it('武裝千金：我方全體[洗牌]（各抽 1）、敵方全體 -3 TP；收買4 讓重創單位下回合只回一半 TP', () => {
    const g = newGame();
    const a0 = g.state.players[0].units[0];
    const [b0, b1] = g.state.players[1].units;
    a0.ap = 6;
    a0.counters.wealth = 4;
    b0.tp = 3;
    const h = give(g, a0.id, 'sav_heiress');
    const a1 = g.state.players[0].units[1];
    const hand0 = a0.hand.length, hand1 = a1.hand.length;
    a1.discard.push(a1.deck.pop()!);
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: h });
    // [洗牌]：棄牌區洗回牌組，再各抽 1 張
    expect(a1.discard.length).toBe(0);
    expect(a0.hand.length).toBe(hand0 - 1 + 1);
    expect(a1.hand.length).toBe(hand1 + 1);
    expect(b0.tp).toBe(0);
    expect(b0.critical).toBe(true);
    expect(b1.tp).toBe(3);
    ans(g, true); // 收買4
    g.apply(0, { type: 'endTurn' });
    expect(b0.tp).toBe(3); // ceil(6/2)
    expect(b1.tp).toBe(6);
  });

  it('週轉：沒手牌時 [收買2] 抽 1、敵方 -1 TP', () => {
    const g = newGame();
    const a0 = g.state.players[0].units[0];
    a0.hand = [];
    a0.counters.wealth = 2;
    expect(g.apply(0, { type: 'ability', unitId: a0.id, abilityId: 'a2' }).ok).toBe(true);
    if (g.state.prompt?.kind === 'unit') ans(g, 'p1u0');
    expect(a0.hand.length).toBe(1);
    expect(a0.counters.wealth).toBe(0);
    expect(g.state.players[1].units.reduce((s, u) => s + u.tp, 0)).toBe(11);
  });

  it('恕不退款(收買4)：不會減少 TP', () => {
    const g = newGame();
    const [a0] = g.state.players[0].units;
    a0.ap = 3; a0.counters.wealth = 4;
    const c = give(g, a0.id, 'sav_norefund');
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: c });
    ans(g, 'p0u0');
    ans(g, true);
    g.strikeOnce(g.state.players[1].units[0], a0);
    expect(a0.tp).toBe(6);
  });
});
