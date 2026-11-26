import { describe, it, expect } from 'vitest';
import { Game, botStep, legalActions, viewFor } from '../src/engine';

const SAV: [string, string] = ['savanna', 'savanna'];
const newGame = (seed = 1) => Game.create({ seed, names: ['A', 'B'], chars: [SAV, SAV], first: 0 });
const ans = (g: Game, value: any) => {
  const r = g.apply(g.state.prompt!.player, { type: 'answer', value });
  expect(r.ok, r.error).toBe(true);
};

describe('開局', () => {
  it('先攻各 2 張 + 起手抽 1 = 3 張；後攻各 3 張；AP 2', () => {
    const g = newGame();
    const [a, b] = g.state.players;
    expect(a.units.map(u => u.hand.length)).toEqual([3, 3]);
    expect(b.units.map(u => u.hand.length)).toEqual([3, 3]);
    expect(a.units.map(u => u.ap)).toEqual([2, 2]);
    expect(g.state.active).toBe(0);
    expect(a.units[0].deck.length + a.units[0].hand.length).toBe(17);
  });

  it('AP 每回合重置：2 → 4 → 6 → 7（上限）', () => {
    const g = newGame();
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      if (g.state.active === 0) seen.push(g.state.players[0].units[0].ap);
      g.state.players[0].units[0].ap = 0; // 用掉
      g.apply(g.state.active, { type: 'endTurn' });
    }
    expect(seen).toEqual([2, 4, 6, 7]);
  });

  it('後攻第一回合也是 2 AP，並抽 1 張（3+1=4）', () => {
    const g = newGame();
    g.apply(0, { type: 'endTurn' });
    const b = g.state.players[1];
    expect(b.units.map(u => u.ap)).toEqual([2, 2]);
    expect(b.units.map(u => u.hand.length)).toEqual([4, 4]);
  });
});

describe('攻擊、TP、負傷、重創', () => {
  it('普攻：-1 AP，造成 AT 傷害並 -1 TP，每回合一次', () => {
    const g = newGame();
    const t = g.state.players[1].units;
    expect(g.apply(0, { type: 'attack', unitId: 'p0u0' }).ok).toBe(true);
    ans(g, 'p1u0');
    expect(t[0].hp).toBe(44);
    expect(t[0].tp).toBe(5);
    expect(g.state.players[0].units[0].ap).toBe(1);
    expect(g.apply(0, { type: 'attack', unitId: 'p0u0' }).ok).toBe(false);
  });

  it('負傷：TP ≤ 一半（6→3）時，之後每次受傷 +1', () => {
    const g = newGame();
    const src = g.state.players[0].units[0];
    const t = g.state.players[1].units[0];
    for (let i = 0; i < 3; i++) g.strikeOnce(src, t); // 3 傷，TP 3 → 負傷
    expect(t.hp).toBe(42);
    expect(t.tp).toBe(3);
    expect(g.isWounded(t)).toBe(true);
    g.strikeOnce(src, t); // 1+1 = 2
    expect(t.hp).toBe(40);
    g.strikeOnce(src, t); // 再 2
    expect(t.hp).toBe(38);
  });

  it('重創：TP 歸零時 -3 HP（只扣一次），回合開始 TP 回滿解除', () => {
    const g = newGame();
    const src = g.state.players[0].units[0];
    const t = g.state.players[1].units[0];
    g.loseTp(t, 6);
    expect(t.critical).toBe(true);
    expect(t.hp).toBe(42);
    g.strikeOnce(src, t); // 重創含負傷：1+1
    expect(t.hp).toBe(40);
    expect(t.tp).toBe(0);
    g.apply(0, { type: 'endTurn' });
    expect(t.tp).toBe(6);
    expect(t.critical).toBe(false);
  });

  it('SP：只能指定 SP 最高的敵人；居前 SP+1，一回合一次', () => {
    const g = newGame();
    g.apply(0, { type: 'endTurn' });
    expect(g.apply(1, { type: 'advance', unitId: 'p1u1' }).ok).toBe(true);
    expect(g.apply(1, { type: 'advance', unitId: 'p1u1' }).ok).toBe(false);
    g.apply(1, { type: 'endTurn' });
    expect(g.targetableEnemies(0).map(u => u.id)).toEqual(['p1u1']);
    g.apply(0, { type: 'attack', unitId: 'p0u0' });
    expect(g.state.prompt).toBeNull(); // 只有一個目標，自動選
    expect(g.state.players[1].units[1].hp).toBe(44);
  });

  it('居前在陷入重創時解除', () => {
    const g = newGame();
    const u = g.state.players[0].units[0];
    g.apply(0, { type: 'advance', unitId: u.id });
    expect(g.effSp(u)).toBe(1);
    g.loseTp(u, 6);
    expect(g.effSp(u)).toBe(0);
  });
});

describe('瀕死、處決、救治、勝負', () => {
  it('HP 歸零進入瀕死：TP 重設、SP -1、受攻擊 -1 TP（每 4 傷再 -1）', () => {
    const g = newGame();
    const t = g.state.players[1].units[0];
    const src = g.state.players[0].units[0];
    g.dealHp(t, 100);
    expect(t.life).toBe('dying');
    expect(t.tp).toBe(6);
    expect(g.effSp(t)).toBe(-1);
    g.attackHit(src, t, 9, true); // 1 + floor(9/4)=2 → -3
    expect(t.tp).toBe(3);
    expect(t.hp).toBe(0);
    g.attackHit(src, t, 1, true);
    g.attackHit(src, t, 1, true);
    g.attackHit(src, t, 1, true);
    expect(t.life).toBe('dead');
  });

  it('瀕死角色不能行動、不抽牌；全員無法行動就輸', () => {
    const g = newGame();
    const [b0, b1] = g.state.players[1].units;
    g.dealHp(b0, 100);
    g.apply(0, { type: 'endTurn' });
    expect(b0.hand.length).toBe(3); // 沒抽
    expect(g.apply(1, { type: 'attack', unitId: b0.id }).ok).toBe(false);
    g.apply(1, { type: 'endTurn' });
    g.dealHp(b1, 100);
    expect(g.state.winner).toBeNull(); // dealHp 不經流程；下一個操作才判定
    g.apply(0, { type: 'advance', unitId: 'p0u0' });
    expect(g.state.winner).toBe(0);
  });

  it('救治：自由分配 HP/AP，以 被救者TP×2 的 HP 回歸，一局一次', () => {
    const g = newGame();
    const [a0, a1] = g.state.players[0].units;
    g.dealHp(a1, 100); // 瀕死，TP 6
    a1.tp = 3;         // 被打掉一些
    // 費用 6，AP 2 → 可以用 0~2 AP
    expect(g.apply(0, { type: 'rescue', unitId: a0.id }).ok).toBe(true);
    expect(g.state.prompt?.kind).toBe('number');
    ans(g, 2);
    expect(a0.ap).toBe(0);
    expect(a0.hp).toBe(41);
    expect(a1.life).toBe('alive');
    expect(a1.hp).toBe(6);
    expect(g.state.players[0].rescueUsed).toBe(true);
  });
});

describe('薩凡娜', () => {
  const give = (g: Game, unitId: string, defId: string) => {
    const u = g.unit(unitId);
    const c = { uid: 'test' + (++g.state.uidCounter), defId };
    u.hand.push(c);
    return c.uid;
  };

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

  it('武裝千金：敵方全體 -3 TP；收買4 讓重創單位下回合只回一半 TP', () => {
    const g = newGame();
    const a0 = g.state.players[0].units[0];
    const [b0, b1] = g.state.players[1].units;
    a0.ap = 6;
    a0.counters.wealth = 4;
    b0.tp = 3;
    const h = give(g, a0.id, 'sav_heiress');
    g.apply(0, { type: 'play', unitId: a0.id, cardUid: h });
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

describe('隨機對打（壓力測試）', () => {
  it('2000 場隨機對局都能正常結束、狀態合理', () => {
    let wins = [0, 0, 0];
    let totalTurns = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const g = Game.create({ seed, names: ['A', 'B'], chars: [SAV, SAV] });
      let r = seed * 7919;
      const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
      let steps = 0;
      while (g.state.winner === null && g.state.turn < 200) {
        const who = g.actor()!;
        const a = botStep(g, who, rnd)!;
        const res = g.apply(who, a);
        if (!res.ok) throw new Error(`seed ${seed}: ${res.error} ${JSON.stringify(a)}`);
        for (const u of [...g.state.players[0].units, ...g.state.players[1].units]) {
          if (u.hp < 0 || u.hp > u.maxHp) throw new Error(`seed ${seed}: hp ${u.hp}`);
          if (u.tp < 0 || u.tp > u.tpMax) throw new Error(`seed ${seed}: tp ${u.tp}`);
          if (u.ap < 0) throw new Error(`seed ${seed}: ap ${u.ap}`);
          if (u.deck.length + u.hand.length + u.discard.length + u.playing.length !== 17) throw new Error(`seed ${seed}: card count`);
        }
        if (++steps > 20000) throw new Error('stuck ' + seed);
      }
      totalTurns += g.state.turn;
      wins[g.state.winner === null ? 2 : g.state.winner === 'draw' ? 2 : g.state.winner]++;
      // 畫面資料可序列化、對手手牌被隱藏
      const v = viewFor(g.state, 0);
      expect(v.players[1].units[0].hand.every(c => c.defId === 'hidden')).toBe(true);
    }
    console.log('勝場', wins, '平均回合', (totalTurns / 2000).toFixed(1));
    expect(wins[0] + wins[1]).toBeGreaterThan(1900);
  });

  it('legalActions 只列出合法操作', () => {
    const g = newGame();
    for (const a of legalActions(g, 0)) expect(g.checkAction(0, a)).toBeNull();
  });
});
