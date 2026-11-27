import { describe, it, expect } from 'vitest';
import { CHAR_DEFS, type Game } from '../src/engine';
import { newGame, answer, give, type Team } from './helpers';

// =====================================================================
// 異端物：手牌付費、掃場、改寫現實
// =====================================================================

const HER: Team = ['heretic', 'savanna'];
const FOE: Team = ['savanna', 'savanna'];

const H = 'p0u0'; // 異端物
const M = 'p0u1'; // 隊友

function fresh(seed = 1): Game {
  const g = newGame(HER, seed, FOE);
  g.unit(H).hand = [];
  g.unit(M).hand = [];
  return g;
}

/** 給一堆牌（回傳 uid 陣列） */
function stack(g: Game, unitId: string, defId: string, n: number): string[] {
  return Array.from({ length: n }, () => give(g, unitId, defId));
}

describe('異端物', () => {
  it('能力 1：卡牌費用改用 HS 支付，不花 AP', () => {
    const g = fresh();
    const h = g.unit(H);
    const play = give(g, H, 'her_intrude');
    give(g, H, 'her_tear'); // 1 張費用
    const deckBefore = h.deck.length;
    const r = g.apply(0, { type: 'play', unitId: H, cardUid: play });
    expect(r.ok, r.error).toBe(true);
    expect(h.ap).toBe(0);
    // 費用 1 張被移除到棄牌區＋打出的牌進棄牌區
    expect(h.discard.length).toBe(2);
    // 能力 3 抽回 1＋【侵入】抽 1
    expect(h.hand.length).toBe(2);
    expect(h.deck.length).toBe(deckBefore - 2);
  });

  it('能力 1：費用可以付隊友的手牌', () => {
    const g = fresh();
    const mate = g.unit(M);
    const play = give(g, H, 'her_beyond');
    give(g, M, 'her_tear'); // 費用由隊友付
    const r = g.apply(0, { type: 'play', unitId: H, cardUid: play });
    expect(r.ok, r.error).toBe(true);
    // 隊友的費用牌被移除；能力 3 抽回 1，【超越】再讓隊友抽 1 張
    expect(mate.discard.length).toBe(1);
    expect(mate.hand.length).toBe(2);
  });

  it('能力 4：打出[異方侵入]前不能主動攻擊', () => {
    const g = fresh();
    const h = g.unit(H);
    stack(g, H, 'her_tear', 2);
    expect(g.checkAction(0, { type: 'attack', unitId: H })).toBe('沒有足夠的攻擊資源');
    g.addCounter(h, 'mode', 1);
    g.addCounter(h, 'intrude', 1);
    expect(g.checkAction(0, { type: 'attack', unitId: H })).toBeNull();
  });

  it('能力 2：移除所有手牌，對敵方全場造成同等[直傷]，之後停止行動', () => {
    const g = fresh();
    const h = g.unit(H);
    g.addCounter(h, 'mode', 1);
    g.addCounter(h, 'intrude', 1);
    stack(g, H, 'her_tear', 3);
    const foes = g.enemiesOf(0);
    const before = foes.map(f => f.hp);
    const r = g.apply(0, { type: 'attack', unitId: H });
    expect(r.ok, r.error).toBe(true);
    expect(foes.map(f => f.hp)).toEqual(before.map(x => x - 3));
    expect(h.noActionTurn).toBe(true);
    // 不會扣 TP（[直傷]）
    expect(foes.every(f => f.tp === g.effTpMax(f))).toBe(true);
    // 能力 3：首次移除手牌讓自己抽回 3 張
    expect(h.hand.length).toBe(3);
    const card = give(g, H, 'her_tear');
    expect(g.checkAction(0, { type: 'play', unitId: H, cardUid: card })).toBe('這回合已停止行動');
  });

  it('能力 3：每回合只有第一次移除手牌會抽回', () => {
    const g = fresh();
    const h = g.unit(H);
    const mate = g.unit(M);
    g.handRemoved(h, [{ unitId: H, n: 2 }, { unitId: M, n: 1 }]);
    expect(h.hand.length).toBe(2);
    expect(mate.hand.length).toBe(1);
    // 同一回合第二次移除：不再抽回
    g.handRemoved(h, [{ unitId: H, n: 3 }]);
    expect(h.hand.length).toBe(2);
    // 自己回合開始時重新計算
    g.addCounter(h, 'firstHS', -1);
    g.handRemoved(h, [{ unitId: H, n: 1 }]);
    expect(h.hand.length).toBe(3);
  });

  it('【臨界點的裁決】：湊出 11 張、費用多來自自身 → [異方侵入]', () => {
    const g = fresh();
    const h = g.unit(H);
    const play = give(g, H, 'her_verdict');
    stack(g, H, 'her_tear', 11);
    const r = g.apply(0, { type: 'play', unitId: H, cardUid: play });
    expect(r.ok, r.error).toBe(true);
    expect(g.counter(h, 'intrude')).toBe(1);
    expect(g.counter(h, 'beyond')).toBe(0);
    expect(h.removed.some(c => c.defId === 'her_verdict')).toBe(true);
    // [異方侵入]：自己的[起手抽牌]改成 3 張
    expect(CHAR_DEFS.heretic.hooks!.turnStartDraw!(g, h)).toBe(3);
    expect(g.checkAction(0, { type: 'attack', unitId: H })).toBeNull();
  });

  it('【臨界點的裁決】回合開始強制打出：付費一樣由玩家自己選（決定型態）', () => {
    const g = fresh();
    const h = g.unit(H);
    give(g, H, 'her_verdict');
    stack(g, H, 'her_tear', 5);
    stack(g, M, 'her_intrude', 6);
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    // 我方回合開始：直接打出，先問要從誰的手牌付
    expect(g.state.prompt?.kind).toBe('option');
    answer(g, 1); // 隊友先付 6 張，剩下 5 張由自己付
    expect(g.counter(h, 'beyond')).toBe(1);
    // [超越此方]當回合就生效：隊友的[起手抽牌]改成檢索，接著問要檢索哪張
    expect(g.state.prompt?.kind).toBe('option');
    expect(g.state.prompt?.title).toContain('超越此方');
    answer(g, 0);
    expect(g.state.prompt).toBe(null);
    expect(h.removed.some(c => c.defId === 'her_verdict')).toBe(true);
  });

  it('【臨界點的裁決】：費用多來自隊友 → [超越此方]（HP 綁定、TP 以隊友為基準）', () => {
    const g = fresh();
    const h = g.unit(H);
    const mate = g.unit(M);
    const play = give(g, H, 'her_verdict');
    stack(g, H, 'her_tear', 5);
    stack(g, M, 'her_intrude', 6);
    // 先選由隊友支付 6 張，剩下的 5 張由自己付
    g.apply(0, { type: 'play', unitId: H, cardUid: play });
    answer(g, 1); // 隊友
    expect(g.counter(h, 'beyond')).toBe(1);
    expect(h.maxHp).toBe(20);
    expect(h.hpLink).toBe(M);
    expect(mate.hpLink).toBe(H);
    expect(mate.tpMax).toBe(8); // 薩凡娜 6 + 2
    expect(mate.at).toBe(2); // 薩凡娜 1 + 1
    expect(h.tpLink).toBe(M);
    expect(h.tp).toBe(mate.tp);

    // HP 綁定：隊友受傷，異端物一起扣
    const hpH = h.hp, hpM = mate.hp;
    g.dealHp(mate, 5);
    expect(mate.hp).toBe(hpM - 5);
    expect(h.hp).toBe(hpH - 5);

    // TP 以隊友為基準：隊友 -1 TP，異端物跟著
    g.loseTp(mate, 1);
    expect(h.tp).toBe(mate.tp);
  });

  it('【超越此方】：隊友的[起手抽牌]改成從牌堆檢索 1 張', () => {
    const g = fresh();
    const h = g.unit(H);
    const mate = g.unit(M);
    g.addCounter(h, 'mode', 2);
    g.addCounter(h, 'beyond', 1);
    // 換到對手，再換回來 → 我方回合開始
    g.apply(0, { type: 'endTurn' });
    const hBefore = h.hand.length, mBefore = mate.hand.length;
    g.apply(1, { type: 'endTurn' }); // 異端物抽 1，隊友停在檢索選擇
    answer(g, 0); // 隊友檢索的選擇
    expect(h.hand.length).toBe(hBefore + 1); // 異端物正常抽 1
    expect(mate.hand.length).toBe(mBefore + 1); // 只檢索 1，沒有再多抽
  });

  it('【撕裂現實】：使隊友[居前]且受到傷害 -1', () => {
    const g = fresh();
    stack(g, H, 'her_tear', 4);
    const play = g.unit(H).hand[0].uid;
    g.apply(0, { type: 'play', unitId: H, cardUid: play });
    answer(g, M);
    const mate = g.unit(M);
    expect(mate.spBonus).toBe(1);
    expect(mate.dmgReduce).toBe(1);
  });

  it('【粉碎幻境】：我方各從棄牌區檢索 1 張，並回復全體 3 HP', () => {
    const g = fresh();
    const mate = g.unit(M);
    mate.hp = 30;
    mate.discard = [{ uid: 'dx1', defId: 'her_intrude' }];
    stack(g, H, 'her_tear', 3);
    const play = give(g, H, 'her_shatter');
    const r = g.apply(0, { type: 'play', unitId: H, cardUid: play });
    expect(r.ok, r.error).toBe(true);
    expect(mate.hand.some(c => c.uid === 'dx1')).toBe(true);
    expect(mate.hp).toBe(33);
  });

  it('【欲望與解析】：指定自身時吸取隊友 6 HP', () => {
    const g = fresh();
    const mate = g.unit(M);
    stack(g, H, 'her_tear', 5);
    const play = give(g, H, 'her_desire');
    g.apply(0, { type: 'play', unitId: H, cardUid: play });
    answer(g, H);
    expect(mate.hp).toBe(mate.maxHp - 6);
  });

  it('【欲望與解析】：指定隊友時該單位抽 1、[洗牌]、獲得臨時 2 TP', () => {
    const g = fresh();
    const mate = g.unit(M);
    stack(g, H, 'her_tear', 5);
    const play = give(g, H, 'her_desire');
    const mHand = mate.hand.length;
    g.apply(0, { type: 'play', unitId: H, cardUid: play });
    answer(g, M);
    expect(mate.tTp).toBe(2);
    expect(mate.hand.length).toBeGreaterThanOrEqual(mHand + 1);
  });

  it('【侵入】、【超越】的基本抽牌', () => {
    const g = fresh();
    stack(g, H, 'her_tear', 1);
    const play = give(g, H, 'her_intrude');
    const before = g.unit(H).hand.length; // 1 張費用＋【侵入】
    g.apply(0, { type: 'play', unitId: H, cardUid: play });
    expect(g.unit(H).hand.length).toBe(before - 1 - 1 + 1 + 1); // 打出、付費、能力 3 抽回、【侵入】抽 1
  });
});
