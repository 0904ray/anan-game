import { describe, it, expect } from 'vitest';
import { legalActions } from '../src/engine';
import { newGame as make, answer as ans, type Team } from './helpers';

// 核心規則用「兩隻薩凡娜」測：數值單純（AT 1、普攻 1 AP、TP 6）
const SAV: Team = ['savanna', 'savanna'];
const newGame = (seed = 1) => make(SAV, seed);

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

  it('TP ≤ 最大值一半時，自己回合開始才會回滿（只看 TP，不看[負傷]狀態）', () => {
    const g = newGame();
    const u = g.state.players[0].units[0]; // TP 6，一半 = 3
    g.loseTp(u, 2); // 剩 4：沒[負傷]
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(u.tp).toBe(4); // 不回復
    g.loseTp(u, 1); // 剩 3：[負傷]
    expect(g.isWounded(u)).toBe(true);
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(u.tp).toBe(6); // 回滿
    g.loseTp(u, 3); // 剩 3，但[負傷]被清掉
    u.noWound = true;
    expect(g.isWounded(u)).toBe(false);
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(u.tp).toBe(6); // 照樣回滿
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

describe('合法操作', () => {
  it('legalActions 只列出合法操作', () => {
    const g = newGame();
    for (const a of legalActions(g, 0)) expect(g.checkAction(0, a)).toBeNull();
  });
});

describe('角色名單與隊伍', () => {
  it('roster 列出所有已登記、沒隱藏的角色', async () => {
    const { roster } = await import('../src/engine');
    expect(roster().map(c => c.id)).toEqual(expect.arrayContaining(['savanna', 'granny']));
  });
  it('isValidTeam：兩隻、都存在；同隊重複看設定', async () => {
    const { isValidTeam } = await import('../src/engine');
    expect(isValidTeam(['savanna', 'granny'], false)).toBe(true);
    expect(isValidTeam(['savanna', 'savanna'], false)).toBe(false);
    expect(isValidTeam(['savanna', 'savanna'], true)).toBe(true);
    expect(isValidTeam(['savanna'], true)).toBe(false);
    expect(isValidTeam(['savanna', 'nobody'], true)).toBe(false);
    expect(isValidTeam('savanna', true)).toBe(false);
  });
  it('randomTeam 組出合法隊伍', async () => {
    const { randomTeam, isValidTeam } = await import('../src/engine');
    for (let i = 0; i < 50; i++) expect(isValidTeam(randomTeam(Math.random, false), false)).toBe(true);
  });
});

describe('牌組空了：只有抽牌會自動洗牌', () => {
  it('從牌組移除、移出牌局，牌組空了也不會把棄牌區洗回來；抽牌才會', () => {
    const g = make(['savanna', 'granny']);
    const u = g.state.players[0].units[0];
    u.discard.push(...u.deck.splice(0)); // 牌組清空，牌都在棄牌區
    const dis = u.discard.length;
    expect(g.mill(u, 3)).toBe(0);
    expect(g.removeDeckTop(u, 2)).toBe(0);
    expect(u.deck.length).toBe(0);
    expect(u.discard.length).toBe(dis);
    // 抽牌：牌組空了才把棄牌區洗回去
    const hand = u.hand.length;
    expect(g.draw(u, 1)).toBe(1);
    expect(u.hand.length).toBe(hand + 1);
    expect(u.discard.length).toBe(0);
    expect(u.deck.length).toBe(dis - 1);
  });
});
