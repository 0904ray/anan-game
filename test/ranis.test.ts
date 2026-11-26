import { describe, it, expect } from 'vitest';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const TEAM: Team = ['ranis', 'savanna'];
const newGame = (seed = 1) => make(TEAM, seed);

type G = ReturnType<typeof newGame>;

/** 給敵方單位掛上[墜淵]（測試用：直接設狀態，不走能力 3） */
function abyss(e: { counters: Record<string, number>; tpMaxDown: number }) {
  e.counters.abyss = 1;
  e.tpMaxDown = 1;
}

/** 牌組換成 n 張指定的牌（抽牌、移除都會照順序從最上面拿） */
function setDeck(g: G, unitId: string, n: number, defId = 'ran_whisper') {
  const u = g.unit(unitId);
  u.deck = Array.from({ length: n }, (_, i) => ({ uid: 't' + (++g.state.uidCounter) + i, defId }));
}

describe('拉尼斯', () => {
  it('基本數值：HP45 AP8 TP8 AT8，主動攻擊 8 AP', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    expect([r.maxHp, r.apMax, r.tpMax, r.at, r.atkCost]).toEqual([45, 8, 8, 8, 8]);
    expect(r.name).toBe('拉尼斯');
  });

  it('能力 3：敵方進入[重創]時給予永久[墜淵]，最大 TP -1（不可疊加）', () => {
    const g = newGame();
    const e = g.unit('p1u0');
    g.loseTp(e, 8);
    expect(e.critical).toBe(true);
    expect(e.counters.abyss).toBe(1);
    expect(e.tpMaxDown).toBe(1);
    expect(g.effTpMax(e)).toBe(7);
    expect(e.hp).toBe(45 - 3); // 重創的 -3 直傷
    // 再進入一次重創不會疊加
    e.critical = false;
    g.loseTp(e, 7);
    expect(e.tpMaxDown).toBe(1);
  });

  it('能力 2：只能指定[墜淵]單位，且不受 SP 限制', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    r.ap = 8;
    // 敵方沒有[墜淵]：不能主動攻擊
    expect(g.apply(0, { type: 'attack', unitId: r.id }).ok).toBe(false);

    // 讓 SP 較低的 e1 帶[墜淵]：SP 規則會擋住，但拉尼斯不受限制
    e0.spBonus = 2;
    abyss(e1);
    const hp0 = e1.hp;
    const res = g.apply(0, { type: 'attack', unitId: r.id });
    expect(res.ok, res.error).toBe(true);
    if (g.state.prompt) ans(g, e1.id);
    expect(e1.hp).toBe(hp0 - 8); // AT 8 的打擊
    expect(e0.hp).toBe(45); // 另一個敵人沒被打到
  });

  it('能力 1：我方每次[洗牌]，對敵方全體造成 AT 1 的[打擊]（每回合最多 3 次）', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    const hp = e0.hp;
    const tp = e0.tp;

    const shuffleOnce = () => {
      r.deck = [];
      r.discard = [{ uid: 'sh' + (++g.state.uidCounter), defId: 'ran_whisper' }];
      g.abilityShuffle(r);
    };
    for (let i = 0; i < 4; i++) shuffleOnce();

    expect(e0.hp).toBe(hp - 3); // 3 次掃場，第 4 次不觸發
    expect(e0.tp).toBe(tp - 3);
    expect(e1.hp).toBe(45 - 3);
    expect(r.counters.shuffles).toBe(3);
  });

  it('能力 4：回合結束時可選至多 3 張手牌移除，之後從牌組移除同樣數量', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    r.hand = [];
    const a = give(g, r.id, 'ran_fish');
    const b = give(g, r.id, 'ran_tide');
    give(g, r.id, 'ran_whisper');
    give(g, r.id, 'ran_sea');
    setDeck(g, r.id, 10);
    const deck0 = r.deck.length;

    expect(g.apply(0, { type: 'endTurn' }).ok).toBe(true);
    expect(g.state.prompt?.kind).toBe('cards');
    ans(g, [a, b]);

    expect(r.hand.length).toBe(2);
    expect(r.removed.length).toBe(4); // 2 張手牌 + 2 張牌組
    expect(r.deck.length).toBe(deck0 - 2);
  });

  it('暴躁魚群：抽 1、敵方全體 1 [直擊]、指定敵人 2 [直傷]、移除 8 張至棄牌區', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    abyss(e1);
    setDeck(g, r.id, 12);
    r.ap = 2;
    const hand0 = r.hand.length;
    const tp0 = e0.tp;

    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_fish') });
    if (g.state.prompt) ans(g, e1.id);

    expect(e0.hp).toBe(45 - 1); // 直擊 1
    expect(e0.tp).toBe(tp0); // 直擊不扣 TP
    expect(e1.hp).toBe(45 - 1 - 2); // 直擊 1 + 指定 2 直傷
    expect(r.discard.length).toBe(9); // 移除 8 張 + 打出的牌
    expect(r.hand.length).toBe(hand0 + 1); // +1 給牌、-1 打出、+1 抽牌
  });

  it('海潮暗湧：抽 1、敵方全體 -1 TP、指定敵人再 -1 TP、移除 8 張', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    abyss(e1);
    setDeck(g, r.id, 12);
    r.ap = 2;
    const tp0 = e0.tp, tp1 = e1.tp;

    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_tide') });
    if (g.state.prompt) ans(g, e1.id);

    expect(e0.tp).toBe(tp0 - 1);
    expect(e1.tp).toBe(tp1 - 1 - 1);
    expect(r.discard.length).toBe(9);
  });

  it('海妖低語：抽 2 張、移除 8 張至棄牌區', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    setDeck(g, r.id, 12);
    r.ap = 2;
    const hand0 = r.hand.length;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_whisper') });
    expect(r.hand.length).toBe(hand0 + 2); // +1 給牌、-1 打出、+2 抽牌
    expect(r.discard.length).toBe(9);
  });

  it('瀆神海域：任一單位進入[重創]時額外 3 [直傷]，觸發後結束', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    r.ap = 4;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_sea') });
    expect(r.counters.desecrate).toBe(1);

    g.loseTp(e0, 8); // 重創：-3（重創）+ 3（瀆神海域）
    expect(e0.hp).toBe(45 - 3 - 3);
    expect(r.counters.desecrate).toBe(0);

    g.loseTp(e1, 8); // 效果已經結束，不再額外扣
    expect(e1.hp).toBe(45 - 3);
  });

  it('瀆神海域：敵方[墜淵]單位 ≥ 2 時自身[洗牌]（並觸發掃場）', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    abyss(g.unit('p1u0'));
    abyss(g.unit('p1u1'));
    r.ap = 4;
    setDeck(g, r.id, 10);
    r.discard = [{ uid: 'dis1', defId: 'ran_whisper' }];
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_sea') });
    expect(r.discard.length).toBe(1); // 只有這張瀆神海域（棄牌區已洗回牌組）
    expect(r.deck.length).toBe(10); // 10 + 1（洗回）－ 1（洗牌抽 1）
    expect(r.counters.shuffles).toBe(1); // 洗牌觸發掃場
    expect(g.unit('p1u0').tp).toBe(8 - 1);
  });

  it('黑漩：抽出時棄牌區 ≤ 1 就移除 8 張；打出時 5 [直傷] 並[洗牌]', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e1 = g.unit('p1u1');
    abyss(e1);

    // 抽出此牌時：棄牌區 0 張 → 移除 8 張至棄牌區
    setDeck(g, r.id, 9);
    r.discard = [];
    r.deck.push({ uid: 'vortex', defId: 'ran_vortex' });
    g.draw(r, 1);
    expect(r.hand.some(c => c.defId === 'ran_vortex')).toBe(true);
    expect(r.discard.length).toBe(8);

    // 打出：5 直傷 + 洗牌（棄牌區洗回牌組、抽 1 張）
    r.deck = Array.from({ length: 6 }, (_, i) => ({ uid: 'k' + i, defId: 'ran_whisper' }));
    r.discard = [{ uid: 'one', defId: 'ran_whisper' }];
    r.ap = 6;
    const hp0 = e1.hp;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: r.hand.find(c => c.defId === 'ran_vortex')!.uid });
    expect(e1.hp).toBe(hp0 - 5 - 1); // 5 直傷 + [洗牌]觸發的掃場（AT 1 打擊）
    expect(r.deck.length).toBe(6); // 6 + 1（棄牌區）－ 1（洗牌抽 1）
    expect(r.discard.length).toBe(1); // 打出的牌
  });

  it('海縛巨錨：-7 TP、受到 2 [直傷]', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e1 = g.unit('p1u1');
    abyss(e1);
    e1.tp = 8;
    r.ap = 8;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_anchor') });
    expect(e1.tp).toBe(1);
    expect(e1.hp).toBe(45 - 2);
  });

  it('血叉：打擊 1 次；指定單位上回合有[重創]時再觸發 1 次', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e1 = g.unit('p1u1');
    abyss(e1);
    e1.tp = 8;
    r.ap = 8;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_fork') });
    expect(e1.hp).toBe(45 - 8);
    expect(e1.tp).toBe(7);

    // 上回合處於[重創]：再一次打擊
    e1.hp = 45;
    e1.tp = 8;
    e1.criticalPrev = true;
    r.ap = 8;
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_fork') });
    expect(e1.hp).toBe(45 - 8 - 8);
    expect(e1.tp).toBe(6);
  });

  it('深淵巨口：已損失生命一半的[直傷]（無條件進位）；瀕死則[處決]並回復 10 HP；用完移除牌局', () => {
    const g = newGame();
    const r = g.unit('p0u0');
    const e1 = g.unit('p1u1');
    abyss(e1);
    r.ap = 8;
    e1.hp = 20; // 已損失 25 → 13 直傷
    g.apply(0, { type: 'play', unitId: r.id, cardUid: give(g, r.id, 'ran_maw') });
    expect(e1.hp).toBe(20 - 13);
    expect(r.removed.some(c => c.defId === 'ran_maw')).toBe(true);
    expect(r.discard.some(c => c.defId === 'ran_maw')).toBe(false);

    // 瀕死：處決並回復自身 10 HP
    const g2 = newGame(2);
    const r2 = g2.unit('p0u0');
    const e = g2.unit('p1u1');
    abyss(e);
    r2.ap = 8;
    r2.hp = 30;
    e.hp = 3;
    g2.apply(0, { type: 'play', unitId: r2.id, cardUid: give(g2, r2.id, 'ran_maw') });
    expect(e.life).toBe('dead');
    expect(r2.hp).toBe(40);
  });
});
