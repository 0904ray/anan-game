import { describe, it, expect } from 'vitest';
import { CHAR_DEFS } from '../src/engine';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const TEAM: Team = ['liliante', 'savanna'];
const FOE: Team = ['savanna', 'savanna'];
const newGame = (seed = 1) => make(TEAM, seed, FOE);

describe('利利安特', () => {
  it('基本數值：HP50 AP8 TP4 AT X × AP 4，AT 等於當前 TP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    expect([l.maxHp, l.apMax, l.tpMax, l.at, l.atkCost]).toEqual([50, 8, 4, 0, 4]);
    expect(l.name).toBe('利利安特');
    expect(g.effAt(l)).toBe(4); // 基礎 AT 0，能力 1 讓 AT = 當前 TP
    l.tp = 2;
    expect(g.effAt(l)).toBe(2);
  });

  it('能力 1：[主動攻擊]不受次數限制', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e = g.unit('p1u0');
    const e2 = g.unit('p1u1');
    l.ap = 8;

    for (let i = 0; i < 2; i++) {
      const r = g.apply(0, { type: 'attack', unitId: l.id });
      expect(r.ok, r.error).toBe(true);
      if (g.state.prompt) ans(g, e2.life === 'alive' ? e2.id : e.id);
    }
    expect(l.attacksThisTurn).toBe(2);
    // 第三次已經沒 AP（每次 4）
    expect(g.checkAction(0, { type: 'attack', unitId: l.id })).toBe('AP 不足');
  });

  it('能力 2：一回合內損失 8 HP 就永久 +1 最大 TP，每回合 1 次、最多 6 次', () => {
    const g = newGame();
    const l = g.unit('p0u0');

    g.dealHp(l, 8);
    expect(l.tpMax).toBe(5);
    g.dealHp(l, 8); // 同一回合第二次不再加
    expect(l.tpMax).toBe(5);
    expect(l.counters.hpLoss).toBe(16);

    // 換一輪讓累計歸零，之後每回合還能再長
    const cycle = () => {
      expect(g.apply(0, { type: 'endTurn' }).ok).toBe(true);
      expect(g.apply(1, { type: 'endTurn' }).ok).toBe(true);
    };
    for (let i = 0; i < 7; i++) {
      cycle();
      l.hp = l.maxHp;
      g.dealHp(l, 8);
    }
    expect(l.tpMax).toBe(10); // 4 + 6（最多 6 次）
    expect(l.counters.grown).toBe(6);
  });

  it('能力 2：進入[負傷]也會 +1 最大 TP（同回合不重複）', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    g.loseTp(l, 2); // TP 4 → 2 ＝ 一半以下：[負傷]
    expect(g.isWounded(l)).toBe(true);
    expect(l.tpMax).toBe(5);

    g.loseTp(l, 1); // 同回合再掉 TP 不會再長
    expect(l.tpMax).toBe(5);
  });

  it('能力 3：任一單位（敵我皆算）進入[負傷]時回復 3 AP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e = g.unit('p1u0');
    l.ap = 0;
    e.tp = 4; // 薩凡娜 TP 6：4 > 3，還沒[負傷]
    g.loseTp(e, 1);
    expect(g.isWounded(e)).toBe(true);
    expect(l.ap).toBe(3);

    // 自己進入[負傷]也算
    l.ap = 1;
    g.loseTp(l, 3); // 4 → 1
    expect(l.ap).toBe(4);

    // AP 不會超過上限
    l.ap = 8;
    const e2 = g.unit('p1u1');
    e2.tp = 4;
    g.loseTp(e2, 1);
    expect(l.ap).toBe(8);
  });

  it('能力 4：[救治]耗費減半', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const mate = g.unit('p0u1');
    mate.life = 'dying';
    mate.hp = 0;
    mate.tp = 4;
    expect(g.rescueCost(l)).toBe(4); // 一般要 8
    expect(g.rescueCost(mate)).toBe(8); // 薩凡娜救治利利安特：照一般規則 TP × 2

    l.ap = 4;
    l.hp = 30;
    const r = g.apply(0, { type: 'rescue', unitId: l.id });
    expect(r.ok, r.error).toBe(true);
    if (g.state.prompt) ans(g, 4);
    expect(l.ap).toBe(0);
    expect(l.hp).toBe(30); // 全部用 AP 付
    expect(mate.life).toBe('alive');
    expect(mate.hp).toBe(4); // 回歸 HP ＝實際支付的花費（共用[救治]規則），所以也一起減半
  });

  it('能力 5：自傷減半（無條件捨去），且不計算[負傷]的額外增傷', () => {
    const g = newGame();
    const l = g.unit('p0u0');

    l.hp = 50;
    l.tp = 4;
    g.strikeSelf(l);
    expect(l.hp).toBe(48); // AT 4 → 2
    expect(l.tp).toBe(3); // [打擊]照樣 -1 TP

    l.hp = 50;
    l.tp = 2; // 負傷：AT 2 → 1，且不再 +1
    g.strikeSelf(l);
    expect(l.hp).toBe(49);
  });

  it('能力 6：[不屈]：瀕死時仍可行動、可以抽牌、SP 不變', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const mate = g.unit('p0u1');
    l.life = 'dying';
    l.hp = 0;
    l.tp = 4;

    expect(g.canAct(l)).toBe(true);
    expect(g.effSp(l)).toBe(0); // 一般瀕死是 -1

    const e = g.unit('p1u0');
    e.life = 'dying';
    e.hp = 0;
    expect(g.effSp(e)).toBe(-1);
    expect(g.canAct(e)).toBe(false);

    l.hand = [];
    expect(g.draw(l, 1)).toBe(1); // 瀕死照樣抽牌
    l.ap = 1;
    const uid = give(g, l.id, 'lil_frenzy');
    const r = g.apply(0, { type: 'play', unitId: l.id, cardUid: uid });
    expect(r.ok, r.error).toBe(true);

    // 瀕死時不能[救治]隊友
    mate.life = 'dying';
    expect(g.checkAction(0, { type: 'rescue', unitId: l.id })).toBe('瀕死時不能[救治]');
  });

  it('牌組：列出的張數共 16 張', () => {
    const c = CHAR_DEFS['liliante'];
    expect(c.deck.reduce((s, [, n]) => s + n, 0)).toBe(16);
    expect(c.deck.map(([id]) => id)).toEqual([
      'lil_frenzy', 'lil_stop', 'lil_realm', 'lil_more', 'lil_fury', 'lil_run', 'lil_death',
    ]);
  });

  it('癲狂鬥魂：-1 TP、回 1 HP；[負傷]時改為 +1 TP、3 HP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    l.hand = [];
    l.ap = 1;
    l.hp = 40;
    l.tp = 4;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_frenzy') });
    expect(l.tp).toBe(3);
    expect(l.hp).toBe(41);

    l.ap = 1;
    l.hp = 40;
    l.tp = 2; // [負傷]
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_frenzy') });
    expect(l.tp).toBe(3); // 「改為」：不扣 TP，直接 +1（2 → 3）
    expect(l.hp).toBe(43);
  });

  it('別停! 別停!：[打擊自身]、抽 1 張；[負傷]時再 +1 TP、抽 1 張', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    l.hand = [];
    l.ap = 2;
    l.hp = 50;
    l.tp = 4;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_stop') });
    expect(l.hp).toBe(48); // AT 4 → 2
    expect(l.tp).toBe(3);
    expect(l.hand.length).toBe(1);

    l.hand = [];
    l.ap = 2;
    l.hp = 50;
    l.tp = 2; // [負傷]：AT 2 → 1
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_stop') });
    expect(l.hp).toBe(49);
    expect(l.tp).toBe(2); // 1 → +1
    expect(l.hand.length).toBe(2); // 抽 2 張
  });

  it('鬥神領域：-3 TP、受到傷害 -1；本回合[負傷]時下 1 次[主動攻擊] -2 AP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e = g.unit('p1u0');
    const e2 = g.unit('p1u1');
    l.hand = [];
    l.ap = 6;
    l.tp = 4;
    l.counters.wt = 1; // 本回合已[負傷]
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_realm') });
    expect(l.tp).toBe(1);
    expect(l.dmgReduce).toBe(1);
    expect(l.counters.nextAtk).toBe(1);

    // 下 1 次主動攻擊只要 2 AP，打完就消耗掉（進[負傷]會觸發能力 3，先把 AP 歸零方便檢查）
    l.ap = 3;
    const r = g.apply(0, { type: 'attack', unitId: l.id });
    expect(r.ok, r.error).toBe(true);
    if (g.state.prompt) ans(g, e2.life === 'alive' ? e2.id : e.id);
    expect(l.ap).toBe(1); // 3 - 2
    expect(l.counters.nextAtk ?? 0).toBe(0);
  });

  it('不夠! 不夠!!：[打擊自身] 2 次、[打擊] 1 名敵方單位、抽 2 張牌', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e = g.unit('p1u0');
    l.hand = [];
    l.ap = 4;
    l.hp = 50;
    l.tp = 4;
    e.hp = 45;
    e.tp = 6;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_more') });
    ans(g, e.id);
    expect(l.hp).toBe(47); // 自傷 2 + 1（第二次 AT 變 3 → 1）
    expect(l.tp).toBe(2);
    expect(e.hp).toBe(43); // AT 2 的[打擊]
    expect(l.hand.length).toBe(2);
  });

  it('兇絕亂擊：本回合[負傷]時只要 2 AP；-2 TP（負傷時改 +2 TP）、+2 HP、下 1 次普攻 -2 AP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    l.hand = [];
    expect(g.cardCost(l, 'lil_fury')).toBe(6);
    l.counters.wt = 1;
    expect(g.cardCost(l, 'lil_fury')).toBe(2);

    // 沒[負傷]：-2 TP、+2 HP
    const g2 = newGame(2);
    const a = g2.unit('p0u0');
    a.hand = [];
    a.ap = 6;
    a.hp = 40;
    a.tp = 4;
    g2.apply(0, { type: 'play', unitId: a.id, cardUid: give(g2, a.id, 'lil_fury') });
    expect(a.hp).toBe(42);
    expect(a.counters.nextAtk).toBe(1);

    // 本回合已[負傷]：-2 TP 改為 +2 TP（回復 2 HP 照樣有）
    l.ap = 2;
    l.hp = 40;
    l.tp = 2;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_fury') });
    expect(l.tp).toBe(4);
    expect(l.hp).toBe(42);
    expect(l.counters.nextAtk).toBe(1);
  });

  it('別想跑!!!：無條件指定敵方單位 SP +1（不受 SP 限制）', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e0 = g.unit('p1u0');
    const e1 = g.unit('p1u1');
    e0.spBonus = 2; // 一般只能指定 SP 最高的 e0
    l.hand = [];
    l.ap = 6;
    l.tp = 4;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_run') });
    ans(g, e1.id);
    expect(e1.spBonus).toBe(1);
    expect(e0.spBonus).toBe(2);
    expect(l.tp).toBe(2);
    expect(l.counters.nextAtk).toBe(1);
  });

  it('承此亦死：無條件[打擊]，再 -X TP（X＝自己損失的 TP）；[負傷]時 +2 TP', () => {
    const g = newGame();
    const l = g.unit('p0u0');
    const e = g.unit('p1u0');
    const e2 = g.unit('p1u1');
    l.hand = [];
    l.ap = 8;
    l.tp = 3; // 損失 1 TP，還沒[負傷]
    e.hp = 45;
    e.tp = 6;
    g.apply(0, { type: 'play', unitId: l.id, cardUid: give(g, l.id, 'lil_death') });
    ans(g, e.id);
    expect(e.hp).toBe(42); // AT 3 的[打擊]
    expect(e.tp).toBe(4); // 6 -1（打擊）-1（X）

    // 本回合已[負傷]：只要 4 AP，X 用損失的 3 TP，之後 +2 TP
    const g2 = newGame(2);
    const a = g2.unit('p0u0');
    const t = g2.unit('p1u0');
    const t2 = g2.unit('p1u1');
    a.hand = [];
    a.ap = 4;
    a.tp = 1; // 損失 3 TP
    a.counters.wt = 1;
    expect(g2.cardCost(a, 'lil_death')).toBe(4);
    t.hp = 45;
    t.tp = 6;
    g2.apply(0, { type: 'play', unitId: a.id, cardUid: give(g2, a.id, 'lil_death') });
    ans(g2, t.id);
    expect(t.hp).toBe(44);
    expect(t.tp).toBe(2); // 6 -1 -3
    expect(a.tp).toBe(3); // +2 TP
    expect(t2.tp).toBe(6); // 沒被指定
    expect(e2.tp).toBe(6);
  });
});
