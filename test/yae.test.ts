import { describe, it, expect } from 'vitest';
import { type Game } from '../src/engine';
import { newGame, answer, give, type Team } from './helpers';

// =====================================================================
// 八重：攻擊翻牌（[拔]）、每 3 次攻擊（[破]）、換兵器
// =====================================================================

const YAE: Team = ['yae', 'savanna'];
const FOE: Team = ['savanna', 'savanna'];

const Y = 'p0u0'; // 八重
const M = 'p0u1'; // 隊友
const E = 'p1u0'; // 敵人
const E2 = 'p1u1';

/**
 * 乾淨的測試局面：八重的手牌、牌組、棄牌區都清空，AP 給足以便一直出牌，
 * 只留 1 個敵人（不用每次選目標），並讓敵人不會掉 TP（避免[負傷]的 +1 影響傷害計算）。
 */
function fresh(seed = 1): Game {
  const g = newGame(YAE, seed, FOE);
  const y = g.unit(Y);
  y.hand = [];
  g.unit(M).hand = [];
  y.deck = [];
  y.discard = [];
  y.ap = 20;
  g.unit(E2).life = 'dead';
  const e = g.unit(E);
  e.hp = e.maxHp;
  e.noTpLoss = true;
  return g;
}

/** 牌組頂（下一個被[拔]翻到的牌） */
const top = (g: Game, defId: string) => g.unit(Y).deck.push({ uid: 'top' + (++g.state.uidCounter), defId });

const atkCount = (g: Game) => g.counter(g.unit(Y), 'atk');
const brkPending = (g: Game) => g.counter(g.unit(Y), 'brk');

describe('八重', () => {
  it('能力 1：普攻也吃[拔]（翻到三合＝追加 1 次[直擊]）', () => {
    const g = fresh();
    const e = g.unit(E);
    top(g, 'yae_blade');
    const r = g.apply(0, { type: 'attack', unitId: Y });
    expect(r.ok, r.error).toBe(true);
    expect(e.hp).toBe(e.maxHp - (3 + 3)); // 打擊 3＋[拔] 的追加直擊 3
    expect(g.unit(Y).deck.length).toBe(0);
    expect(g.unit(Y).discard.length).toBe(1); // 翻到的牌被[移除]至棄牌區
    expect(atkCount(g)).toBe(1);
  });

  it('能力 1：翻到的牌沒有[拔]（泰坦之心）就只算原本的傷害', () => {
    const g = fresh();
    const e = g.unit(E);
    top(g, 'yae_heart');
    g.apply(0, { type: 'attack', unitId: Y });
    expect(e.hp).toBe(e.maxHp - 3);
    expect(g.unit(Y).discard.length).toBe(1);
  });

  it('能力 1：牌堆空了就不翻、沒有[拔]', () => {
    const g = fresh();
    const e = g.unit(E);
    g.apply(0, { type: 'attack', unitId: Y });
    expect(e.hp).toBe(e.maxHp - 3);
    expect(g.unit(Y).discard.length).toBe(0);
    expect(atkCount(g)).toBe(1);
  });

  it('能力 2：第 3 次攻擊才觸發[破]，前兩次沒有', () => {
    const g = fresh();
    const e = g.unit(E);
    for (let i = 0; i < 3; i++) give(g, Y, 'yae_blade');
    const play = () => g.apply(0, { type: 'play', unitId: Y, cardUid: g.unit(Y).hand[0].uid });

    play();
    expect(e.hp).toBe(e.maxHp - 2); // 三合：AT 3 - 1
    play();
    expect(e.hp).toBe(e.maxHp - 4);
    play(); // 第 3 次：三合[破]＝追加 2 次[直擊]
    expect(e.hp).toBe(e.maxHp - (4 + 2 + 3 + 3));
    expect(atkCount(g)).toBe(3);
  });

  it('能力 2：泰坦之心讓下一次攻擊強制觸發[破]（不影響計數）', () => {
    const g = fresh();
    const e = g.unit(E);
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_heart') });
    expect(brkPending(g)).toBe(1);
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_blade') });
    // 第 1 次攻擊就[破]：2＋2 次直擊（3＋3）
    expect(e.hp).toBe(e.maxHp - 8);
    expect(brkPending(g)).toBe(0);
    expect(atkCount(g)).toBe(1);
  });

  it('能力 2：次數在自己的回合開始時歸零', () => {
    const g = fresh();
    g.apply(0, { type: 'attack', unitId: Y });
    expect(atkCount(g)).toBe(1);
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(atkCount(g)).toBe(0);
  });

  it('能力 3：架勢——花 1 AP 把手牌放到牌庫頂', () => {
    const g = fresh();
    const a = give(g, Y, 'yae_blade');
    give(g, Y, 'yae_heart');
    const hp = g.unit(Y).ap;
    g.apply(0, { type: 'ability', unitId: Y, abilityId: 'a3' });
    expect(g.state.prompt?.kind).toBe('cards');
    answer(g, [a]);
    const y = g.unit(Y);
    expect(y.ap).toBe(hp - 1);
    expect(y.deck[y.deck.length - 1].uid).toBe(a);
    expect(y.hand.length).toBe(1);
  });

  it('能力 4：一心——回合開始時有手牌就不抽', () => {
    const g = fresh();
    give(g, Y, 'yae_heart');
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(g.unit(Y).hand.length).toBe(1); // 沒有多抽
  });

  it('能力 4：一心——回合開始時沒有手牌才抽 1 張', () => {
    const g = fresh();
    give(g, Y, 'yae_heart');
    g.unit(Y).deck = [{ uid: 'd1', defId: 'yae_blade' }];
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' }); // 有手牌，不抽
    expect(g.unit(Y).hand.length).toBe(1);
    g.unit(Y).hand = [];
    g.unit(Y).deck = [{ uid: 'd2', defId: 'yae_blade' }];
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(g.unit(Y).hand.length).toBe(1); // 沒有手牌 → 抽 1
  });

  it('能力 5：主動攻擊觸發[破]時回復 3 AP（可以超過上限）', () => {
    const g = fresh();
    g.addCounter(g.unit(Y), 'atk', 2); // 下一次是第 3 次攻擊
    g.unit(Y).ap = 10;
    g.apply(0, { type: 'attack', unitId: Y });
    expect(g.unit(Y).ap).toBe(10); // 10 - 3（普攻）+ 3（豪破）
  });

  it('【泰坦之心】：抽 1 張牌，下一次攻擊觸發[破]', () => {
    const g = fresh();
    g.unit(Y).deck = [{ uid: 'd1', defId: 'yae_blade' }];
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_heart') });
    expect(g.unit(Y).hand.length).toBe(1);
    expect(brkPending(g)).toBe(1);
  });

  it('【三合】[拔]：[打擊]後對同一目標追加 1 次[直擊]', () => {
    const g = fresh();
    const e = g.unit(E);
    top(g, 'yae_blade');
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_blade') });
    expect(e.hp).toBe(e.maxHp - 5); // 2（AT 3 - 1）＋3（直擊）
    expect(e.tp).toBe(6); // [直擊]不扣 TP，打擊扣的 1 因為 noTpLoss 不變
  });

  it('【三合】[破]：對同一目標追加 2 次[直擊]', () => {
    const g = fresh();
    const e = g.unit(E);
    g.addCounter(g.unit(Y), 'atk', 2);
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_blade') });
    expect(e.hp).toBe(e.maxHp - 8); // 2＋3＋3
  });

  it('[拔]與[破]同時觸發：翻到三合、且是第 3 次攻擊', () => {
    const g = fresh();
    const e = g.unit(E);
    g.addCounter(g.unit(Y), 'atk', 2);
    top(g, 'yae_blade');
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_blade') });
    expect(e.hp).toBe(e.maxHp - (2 + 3 + 3 + 3)); // 本次 2＋[拔] 1 次＋[破] 2 次
  });

  it('【真鳴】：打擊並自身 -2 HP；[拔]追加 -2 TP、[破]追加 -3 TP', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    e.noTpLoss = false;
    top(g, 'yae_hammer');
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_hammer') });
    expect(e.hp).toBe(e.maxHp - 3);
    expect(e.tp).toBe(6 - 1 - 2); // 打擊 -1、[拔] -2
    expect(y.hp).toBe(y.maxHp - 2);

    const g2 = fresh(2);
    const y2 = g2.unit(Y);
    const e2 = g2.unit(E);
    e2.noTpLoss = false;
    g2.addCounter(y2, 'atk', 2);
    g2.apply(0, { type: 'play', unitId: Y, cardUid: give(g2, Y, 'yae_hammer') });
    expect(e2.tp).toBe(6 - 1 - 3); // [破] -3
  });

  it('【長歌】：[打擊]後[移除]1 張自己的手牌；[拔]追加 1 點[直傷]', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    top(g, 'yae_bow');
    const extra = give(g, Y, 'yae_heart');
    give(g, Y, 'yae_heart');
    give(g, Y, 'yae_bow'); // 要打出的牌
    const play = y.hand.find(c => c.defId === 'yae_bow')!.uid;
    g.apply(0, { type: 'play', unitId: Y, cardUid: play });
    expect(g.state.prompt?.kind).toBe('cards');
    answer(g, [extra]);
    expect(e.hp).toBe(e.maxHp - (3 + 1)); // 打擊 3＋[拔] 1 點直傷
    expect(y.hand.length).toBe(1);
    expect(y.discard.some(c => c.uid === extra)).toBe(true); // 被[移除]至棄牌區
  });

  it('【長歌】[破]：追加 3 點[直傷]', () => {
    const g = fresh();
    const e = g.unit(E);
    g.addCounter(g.unit(Y), 'atk', 2);
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_bow') });
    expect(e.hp).toBe(e.maxHp - (3 + 3));
  });

  it('【備】：抽 2 張牌、+1 [臨時TP]', () => {
    const g = fresh();
    const y = g.unit(Y);
    y.deck = [{ uid: 'd1', defId: 'yae_blade' }, { uid: 'd2', defId: 'yae_blade' }];
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_prep') });
    expect(y.hand.length).toBe(2);
    expect(y.tTp).toBe(1);
  });

  it('【無念斷】：[打擊]全體敵方單位並抽 1 張牌', () => {
    const g = fresh();
    const e = g.unit(E);
    e.noTpLoss = false;
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_tachi') });
    expect(e.hp).toBe(e.maxHp - 3);
    expect(e.tp).toBe(5);
  });

  it('【無念斷】[拔]：本次傷害為[直傷]（固定傷害、不扣 TP）', () => {
    const g = fresh();
    const e = g.unit(E);
    e.noTpLoss = false;
    e.dmgReduce = 2;
    top(g, 'yae_tachi');
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_tachi') });
    expect(e.hp).toBe(e.maxHp - 3); // 減傷不影響[直傷]
    expect(e.tp).toBe(6);
  });

  it('【無念斷】[破]：本次傷害為[直傷]且 +2 AT', () => {
    const g = fresh();
    const e = g.unit(E);
    e.noTpLoss = false;
    g.addCounter(g.unit(Y), 'atk', 2);
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_tachi') });
    expect(e.hp).toBe(e.maxHp - 5);
    expect(e.tp).toBe(6);
  });

  it('【赤山】：可以打隊友（本次傷害 +1 AT）', () => {
    const g = fresh();
    const m = g.unit(M);
    give(g, Y, 'yae_axe');
    g.apply(0, { type: 'play', unitId: Y, cardUid: g.unit(Y).hand[0].uid });
    expect(g.state.prompt?.kind).toBe('unit');
    answer(g, M);
    expect(m.hp).toBe(m.maxHp - 4);
    expect(g.unit(E).hp).toBe(g.unit(E).maxHp); // 敵人沒被打
  });

  it('【赤山】[拔]：回復這次攻擊實際造成的 HP 傷害', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    y.hp = 30;
    top(g, 'yae_axe');
    give(g, Y, 'yae_axe');
    g.apply(0, { type: 'play', unitId: Y, cardUid: y.hand[0].uid });
    answer(g, E);
    expect(e.hp).toBe(e.maxHp - 4);
    expect(y.hp).toBe(34);
  });

  it('【赤山】[破]：回復同樣的 HP，且本次傷害再 +1 AT', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    y.hp = 20;
    g.addCounter(y, 'atk', 2);
    top(g, 'yae_axe');
    give(g, Y, 'yae_axe');
    g.apply(0, { type: 'play', unitId: Y, cardUid: y.hand[0].uid });
    answer(g, E);
    expect(e.hp).toBe(e.maxHp - 5); // AT 3＋1（牌）＋1（[破]）
    expect(y.hp).toBe(30); // 20＋5（[拔]）＋5（[破]）
  });

  it('【無方】：+5 AP、-2 TP，選(1)後下一次[拔]觸發 3 次', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    y.tp = 7;
    const ap = y.ap;
    const voidCard = give(g, Y, 'yae_void');
    give(g, Y, 'yae_blade');
    g.apply(0, { type: 'play', unitId: Y, cardUid: voidCard });
    expect(y.ap).toBe(ap - 7 + 5);
    expect(y.tp).toBe(5);
    expect(g.state.prompt?.kind).toBe('option');
    answer(g, 0);
    // 之後選 1 張手牌放到牌庫頂（只剩三合）
    expect(y.deck[y.deck.length - 1].defId).toBe('yae_blade');
    // 普攻翻到三合：[拔]觸發 3 次＝3 次直擊
    g.apply(0, { type: 'attack', unitId: Y });
    expect(e.hp).toBe(e.maxHp - (3 + 3 + 3 + 3));
    expect(g.counter(y, 'p3')).toBe(0);
  });

  it('【無方】(2)：下一次攻擊 +3 AT', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    give(g, Y, 'yae_void');
    g.apply(0, { type: 'play', unitId: Y, cardUid: y.hand[0].uid });
    answer(g, 1);
    expect(g.counter(y, 'atUp')).toBe(3);
    y.deck = [];
    y.hand = [];
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_blade') });
    expect(e.hp).toBe(e.maxHp - 5); // AT 3 + 3 - 1
  });

  it('【無方】(3)：攻擊牌費用 -1 AP，且下一次攻擊觸發[破]', () => {
    const g = fresh();
    const y = g.unit(Y);
    give(g, Y, 'yae_void');
    const blade = give(g, Y, 'yae_blade');
    give(g, Y, 'yae_blade'); // 第 2 張會被「放到牌庫頂」，留 1 張在手牌驗證降費
    g.apply(0, { type: 'play', unitId: Y, cardUid: y.hand.find(c => c.defId === 'yae_void')!.uid });
    answer(g, 2); // 選(3)
    expect(g.state.prompt?.kind).toBe('cards');
    answer(g, [blade]);
    const c = y.hand.find(x => x.uid === blade)!;
    expect(g.cardCost(y, c)).toBe(1); // 2 - 1
    expect(g.counter(y, 'brk')).toBe(1);
  });

  it('【無方】(4)：[處決] 1 名[瀕死]的敵方單位', () => {
    const g = fresh();
    const y = g.unit(Y);
    const e = g.unit(E);
    g.unit(E2).life = 'alive';
    g.unit(E2).hp = g.unit(E2).maxHp;
    e.hp = 0;
    e.life = 'dying';
    e.tp = g.effTpMax(e);
    give(g, Y, 'yae_void');
    g.apply(0, { type: 'play', unitId: Y, cardUid: y.hand[0].uid });
    expect(g.state.prompt?.kind).toBe('option');
    const labels = (g.state.prompt as any).options as string[];
    answer(g, labels.findIndex(t => t.includes('處決')));
    expect(e.life).toBe('dead');
  });

  it('【無方】[拔]：回復 2 AP', () => {
    const g = fresh();
    const y = g.unit(Y);
    y.ap = 10;
    top(g, 'yae_void');
    g.apply(0, { type: 'attack', unitId: Y });
    expect(y.ap).toBe(10 - 3 + 2);
  });

  it('攻擊牌算 1 次攻擊：無念斷打全體也只算 1 次', () => {
    const g = fresh();
    g.unit(E2).life = 'alive';
    g.unit(E2).hp = g.unit(E2).maxHp;
    g.apply(0, { type: 'play', unitId: Y, cardUid: give(g, Y, 'yae_tachi') });
    expect(atkCount(g)).toBe(1);
    expect(g.unit(E).hp).toBeLessThan(g.unit(E).maxHp);
    expect(g.unit(E2).hp).toBeLessThan(g.unit(E2).maxHp);
  });
});
