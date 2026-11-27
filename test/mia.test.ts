import { describe, it, expect } from 'vitest';
import { newGame as make, answer as ans, give, type Team } from './helpers';

const TEAM: Team = ['mia', 'savanna'];
const newGame = (seed = 1) => make(TEAM, seed);

describe('米雅', () => {
  it('基本數值：HP40 AP7 TP4 AT0', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    expect([m.maxHp, m.apMax, m.tpMax, m.at]).toEqual([40, 7, 4, 0]);
    expect(m.name).toBe('米雅');
  });

  it('能力 1：[救治]不限次數，而且不佔用一局一次的額度', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');

    const rescue = () => {
      mate.life = 'dying';
      mate.hp = 0;
      mate.tp = 4;
      m.ap = 7;
      m.hp = 40;
      const r = g.apply(0, { type: 'rescue', unitId: m.id });
      expect(r.ok, r.error).toBe(true);
      if (g.state.prompt) ans(g, 7); // 需要支付 8（HP+AP）
      expect(mate.life).toBe('alive');
    };

    rescue();
    expect(g.state.players[0].rescueUsed).toBe(false); // 沒有用掉一局一次的救治
    rescue(); // 第二次也可以
    rescue(); // 第三次也可以

    // 隊友之後仍然可以救治米雅
    mate.life = 'alive';
    mate.hp = 45;
    m.life = 'dying';
    m.hp = 0;
    m.tp = 4;
    const r = g.apply(0, { type: 'rescue', unitId: mate.id });
    expect(r.ok, r.error).toBe(true);
    if (g.state.prompt) ans(g, 0);
    expect(m.life).toBe('alive');
  });

  it('能力 2【聖旨】：花費 2 AP 給予我方 1 名單位[聖環]，已擁有[聖環]的不能再選', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.ap = 7;

    expect(g.apply(0, { type: 'ability', unitId: m.id, abilityId: 'a2' }).ok).toBe(true);
    ans(g, mate.id);
    expect(mate.counters.holy).toBe(1);
    expect(m.ap).toBe(5);

    // 只剩米雅自己沒有[聖環]：直接指定，不用選
    expect(g.apply(0, { type: 'ability', unitId: m.id, abilityId: 'a2' }).ok).toBe(true);
    expect(g.state.prompt).toBe(null);
    expect(m.counters.holy).toBe(1);
    expect(m.ap).toBe(3);

    // 兩隻都有[聖環]了：不能再用
    expect(g.apply(0, { type: 'ability', unitId: m.id, abilityId: 'a2' }).ok).toBe(false);
  });

  it('能力 3：每回合我方單位首次回復 HP 時抽 1 張牌（同回合第二次就不抽）', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    mate.hp = 20;
    const hand0 = m.hand.length;

    g.heal(mate, 1);
    expect(m.hand.length).toBe(hand0 + 1);

    g.heal(mate, 1);
    expect(m.hand.length).toBe(hand0 + 1); // 這回合已經抽過

    // 滿血不算「回復」
    const g2 = newGame(2);
    const m2 = g2.unit('p0u0');
    const mate2 = g2.unit('p0u1');
    const h2 = m2.hand.length;
    g2.heal(mate2, 3);
    expect(m2.hand.length).toBe(h2);
  });

  it('能力 4：隊友擁有[聖環]時 SP -1', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    expect(g.effSp(m)).toBe(0);
    mate.counters.holy = 1;
    expect(g.effSp(m)).toBe(-1);
  });

  it('[聖環]：受到治療時多回 1 HP；自己回合結束回 1 HP；自己回合開始時解除', () => {
    const g = newGame();
    const mate = g.unit('p0u1');
    mate.hp = 20;
    mate.counters.holy = 1;

    g.heal(mate, 3); // 3 + 聖環 1
    expect(mate.hp).toBe(24);

    // 我方回合結束：聖環回 1 HP
    expect(g.apply(0, { type: 'endTurn' }).ok).toBe(true);
    expect(mate.hp).toBe(25);
    expect(mate.counters.holy).toBe(1); // 對手回合還在

    // 我方下個回合開始：解除
    g.apply(1, { type: 'endTurn' });
    expect(mate.counters.holy ?? 0).toBe(0);
  });

  it('聖雅嘆息：回復 1 HP，上回合有[負傷]改為 2 HP', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 7;

    mate.hp = 20;
    mate.woundedPrev = false;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_sigh') });
    ans(g, mate.id);
    expect(mate.hp).toBe(21);

    mate.hp = 20;
    mate.woundedPrev = true;
    m.ap = 7;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_sigh') });
    ans(g, mate.id);
    expect(mate.hp).toBe(22);
  });

  it('渙散祈禱：全體 1 HP；[聖環]單位再 2 HP、抽 1 張', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 2;
    m.hp = 20;
    mate.hp = 20;
    mate.counters.holy = 1;
    const hand0 = mate.hand.length;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_prayer') });
    expect(m.hp).toBe(21); // 1 HP
    expect(mate.hp).toBe(24); // 1 + 2 = 3，再加[聖環]的治療加成 1（同一張牌只算一次治療）
    expect(mate.hand.length).toBe(hand0 + 1);
  });

  it('麻煩死了：臨時 1 TP；[聖環]單位改為 3 TP', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 4;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_trouble') });
    ans(g, mate.id);
    expect(mate.tTp).toBe(1);

    mate.counters.holy = 1;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_trouble') });
    ans(g, mate.id);
    expect(mate.tTp).toBe(4); // 1 + 3

    // 臨時 TP 先被扣
    const tp0 = mate.tp;
    g.loseTp(mate, 1);
    expect(mate.tTp).toBe(3);
    expect(mate.tp).toBe(tp0);
  });

  it('恩典：3 HP 且該單位抽 1 張；[聖環]改為 5 HP、抽 2 張', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 7;

    mate.hp = 20;
    const h0 = mate.hand.length;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_grace') });
    ans(g, mate.id);
    expect(mate.hp).toBe(23);
    expect(mate.hand.length).toBe(h0 + 1);

    mate.hp = 20;
    mate.counters.holy = 1;
    const h1 = mate.hand.length;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_grace') });
    ans(g, mate.id);
    expect(mate.hp).toBe(26); // 5 + 聖環 1
    expect(mate.hand.length).toBe(h1 + 2);
  });

  it('告罪：敵方 -2 AT，我方下個回合開始時恢復', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const e = g.unit('p1u0');
    m.hand = [];
    m.ap = 4;
    e.at = 5;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_confess') });
    ans(g, e.id);
    expect(e.at).toBe(3);
    expect(e.counters.atDown).toBe(2);

    // AT 0 的目標：實際扣多少記多少（不會變負）
    const e1 = g.unit('p1u1');
    e1.at = 0;
    m.ap = 4;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_confess') });
    ans(g, e1.id);
    expect(e1.at).toBe(0);
    expect(e1.counters.atDown).toBe(0);

    // 我方下個回合開始：加回去
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(e.at).toBe(5);

    // 米雅中途陣亡也會恢復（狀態掛在目標身上）
    m.ap = 4;
    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_confess') });
    ans(g, e.id);
    expect(e.at).toBe(3);
    m.life = 'dead';
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(e.at).toBe(5);
    expect(e.counters.atDown ?? 0).toBe(0);
  });

  it('沒興趣：我方全體傷害 -1；[聖環]單位 -2', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 5;
    mate.counters.holy = 1;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_bored') });
    expect(m.dmgReduce).toBe(1);
    expect(mate.dmgReduce).toBe(2);

    // 真的減傷
    const e = g.unit('p1u0');
    e.at = 5;
    const hp = mate.hp;
    g.attackHit(e, mate, 5, true, true);
    expect(mate.hp).toBe(hp - 3);
  });

  it('不公之恩寵 (1)：永久[聖環] + 永久 1 TP，永久[聖環]不會解除', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 7;
    const tpMax0 = mate.tpMax;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_favor') });
    ans(g, 0); // 選項 1（沒有瀕死隊友時是第 1 項）
    ans(g, mate.id);
    expect(mate.counters.holyP).toBe(1);
    expect(mate.tpMax).toBe(tpMax0 + 1);

    // 永久[聖環]：回合換過一輪也不會解除
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(mate.counters.holyP).toBe(1);
  });

  it('不公之恩寵 (2)：無條件救治瀕死隊友，再回復 5 HP', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 7;
    mate.life = 'dying';
    mate.hp = 0;
    mate.tp = 4;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_favor') });
    ans(g, 1); // 有瀕死隊友：選項 2
    expect(mate.life).toBe('alive');
    expect(mate.hp).toBe(8 + 5); // 以 TP×2 回歸，再回復 5
    expect(g.state.players[0].rescueUsed).toBe(false);
  });

  it('不公之恩寵 (3)：我方全體回復 10 HP；使用 2 次後移出牌局', () => {
    const g = newGame();
    const m = g.unit('p0u0');
    const mate = g.unit('p0u1');
    m.hand = [];
    m.ap = 7;
    m.hp = 10;
    mate.hp = 10;

    g.apply(0, { type: 'play', unitId: m.id, cardUid: give(g, m.id, 'mia_favor') });
    ans(g, 1); // 沒有瀕死隊友時，全體 10 HP 是第 2 項
    expect(m.hp).toBe(20);
    expect(mate.hp).toBe(20);
    expect(m.removed.length).toBe(0);

    m.ap = 7;
    const second = give(g, m.id, 'mia_favor');
    g.apply(0, { type: 'play', unitId: m.id, cardUid: second });
    ans(g, 1);
    expect(m.removed.filter(c => c.defId === 'mia_favor').length).toBe(1); // 第 2 次使用後移出牌局
    expect(m.removed.some(c => c.uid === second)).toBe(true);
    expect(m.discard.some(c => c.uid === second)).toBe(false);
  });
});
