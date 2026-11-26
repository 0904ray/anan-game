import { registerChar, registerEndOfTurn, type CardDef, type CharDef } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 薩維爾：直擊、連擊、小破（17 張）
// =====================================================================

const F = 'flame';   // [焰能]：本回合可主動攻擊的次數（每層 1 次），回合結束清空
const C = 'combo';   // 本回合已攻擊次數（[連擊 X] 的 X）
const B = 'boost';   // 下一次攻擊 AT +1（不可疊加）
const E = 'ember';   // 薩達莉亞的餘燼：本回合每次攻擊額外 +1 直傷
const D = 'firstAtk'; // 本回合是否已觸發「首次主動攻擊抽牌」
const S = 'scheduled'; // 是否已排入回合結束的清理

/** 放在「被指定的單位」身上的標記（不屬於薩維爾，所以用目標自己的 counters 存） */
const W = 'wanted';  // 火神的通緝令：受到[直擊]時額外 1 直傷
const N = 'atDown';  // 下回合 -1 AT（要回復的數量）

const FLAME_MAX = 6;
const TURN_END = 'savielEndTurn';

/** 排入回合結束的清理（每回合只排一次） */
function schedule(g: Game, u: Unit) {
  if (g.counter(u, S)) return;
  g.addCounter(u, S, 1);
  g.state.endOfTurn.push({ kind: TURN_END, by: u.id });
}

function gainFlame(g: Game, u: Unit, n: number) {
  const got = Math.min(n, FLAME_MAX - g.counter(u, F));
  if (got <= 0) { g.log(`${u.name} 的[焰能]已達上限 ${FLAME_MAX}`, u.owner); return; }
  g.addCounter(u, F, got);
  g.log(`${u.name} +${got} [焰能]（${g.counter(u, F)}）`, u.owner);
  schedule(g, u);
}

/**
 * 薩維爾的[打擊]一律是[直擊]（傷害照算，但不減少 TP）。
 * 這裡一併處理[連擊]計數、[連擊 3、4、5]的下一次攻擊加成、[連擊 6]的傷害加倍，
 * 以及「受到直擊時」與「每次攻擊時」的額外直傷。
 * power 有給就是用指定數值取代 AT。
 */
function hit(g: Game, u: Unit, t: Unit, power?: number): number {
  if (t.life === 'dead') return 0;
  const combo = g.counter(u, C) + 1; // 含當下這次攻擊
  let base = power ?? g.effAt(u);
  if (power !== undefined) base += g.counter(u, B); // 固定數值也吃「下一次攻擊 +1 AT」
  const doubled = combo === 6;
  const dmg = g.strikeOnce(u, t, { direct: true, power: doubled ? base * 2 : base });
  afterHit(g, u, t, dmg, doubled);
  return dmg;
}

/** 一次[打擊]之后：連擊計數、下一次攻擊加成、通緝令與餘燼的額外直傷 */
function afterHit(g: Game, u: Unit, t: Unit, dmg: number, doubled: boolean) {
  if (doubled) g.log(`[連擊 6] 本次傷害 ×2（${dmg}）`, u.owner);
  g.addCounter(u, C, 1);
  // 「下一次攻擊 +1 AT」用完就消耗，並在 3、4、5 之後重新給 1 層
  if (g.counter(u, B) > 0) g.addCounter(u, B, -g.counter(u, B));
  const now = g.counter(u, C);
  if (now === 3 || now === 4 || now === 5) g.addCounter(u, B, 1);
  schedule(g, u);

  if ((t.life as string) !== 'dead' && g.counter(t, W) > 0) {
    g.log(`【火神的通緝令】${t.name} 額外承受 1 點[直傷]`, u.owner);
    g.dealHp(t, 1);
  }
  if ((t.life as string) !== 'dead' && g.counter(u, E) > 0) {
    g.log(`【薩達莉亞的餘燼】${t.name} 額外承受 1 點[直傷]`, u.owner);
    g.dealHp(t, 1);
  }
}

/** 下一次攻擊 +1 AT（不可疊加） */
function boostNext(g: Game, u: Unit, why: string) {
  if (g.counter(u, B) > 0) { g.log(`${why}：下一次攻擊已經是 +1 AT（不可疊加）`, u.owner); return; }
  g.addCounter(u, B, 1);
  g.log(`${why}：下一次攻擊 AT +1`, u.owner);
}

const cards: CardDef[] = [
  {
    id: 'svi_instant', charId: 'saviel', name: '瞬焰', cost: 1,
    text: '+1 [焰能]，抽 1 張牌。當[連擊 1、2] 下一次攻擊 AT +1（不可疊加）。',
    *play(g, u) {
      gainFlame(g, u, 1);
      g.draw(u, 1);
      const c = g.counter(u, C);
      if (c === 1 || c === 2) boostNext(g, u, `[連擊 ${c}] 瞬焰`);
    },
  },
  {
    id: 'svi_draw', charId: 'saviel', name: '速拔', cost: 1,
    text: '打擊 1 名單位。當[連擊 1] 再打擊 1 名單位，並使該單位下回合 -1 AT。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '速拔：選擇打擊目標');
      if (!t) return;
      g.log(`${u.name} [直擊] ${t.name}`, u.owner);
      hit(g, u, t);
      if (g.counter(u, C) !== 1 || t.life === 'dead') return;
      g.log(`[連擊 1] 速拔：再[直擊] ${t.name}，並使其下回合 -1 AT`, u.owner);
      hit(g, u, t);
      if ((t.life as string) === 'dead' || t.at <= 0) return;
      t.at -= 1;
      g.addCounter(t, N, 1);
      g.log(`${t.name} 下回合 AT -1`, u.owner);
    },
  },
  {
    id: 'svi_load', charId: 'saviel', name: '裝填', cost: 2,
    text: '+2 [焰能]，抽 2 張牌。當[連擊 0] 再 +1 [焰能]。',
    *play(g, u) {
      gainFlame(g, u, 2);
      g.draw(u, 2);
      if (g.counter(u, C) === 0) {
        g.log('[連擊 0] 裝填：再 +1 [焰能]', u.owner);
        gainFlame(g, u, 1);
      }
    },
  },
  {
    id: 'svi_wanted', charId: 'saviel', name: '火神的通緝令', cost: 3,
    text: '指定 1 名敵方單位，本回合其受到[直擊]時額外承受 1 點[直傷]。當[連擊 0] +1 AP。',
    *play(g, u) {
      const t = yield* g.chooseUnit(u.owner, '火神的通緝令：指定 1 名敵方單位', g.enemiesOf(u.owner));
      schedule(g, u);
      if (t) {
        g.addCounter(t, W, 1);
        g.log(`【火神的通緝令】${t.name} 本回合受到[直擊]時額外承受 1 點[直傷]`, u.owner);
      }
      if (g.counter(u, C) === 0) {
        u.ap += 1;
        g.log('[連擊 0] 火神的通緝令：+1 AP', u.owner);
      }
    },
  },
  {
    id: 'svi_ring', charId: 'saviel', name: '火輪擊', cost: 3,
    text: '對 1 名單位造成 [焰能] 數 ×2 的[直擊]，隨後清空[焰能]。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '火輪擊：選擇打擊目標');
      if (!t) return;
      const n = g.counter(u, F);
      g.log(`火輪擊：[焰能] ${n} 層，對 ${t.name} 造成 ${n * 2} 點[直擊]`, u.owner);
      hit(g, u, t, n * 2);
      g.addCounter(u, F, -n);
      g.log('[焰能] 清空', u.owner);
    },
  },
  {
    id: 'svi_ember', charId: 'saviel', name: '薩達莉亞的餘燼', cost: 6,
    text: '+5 AP。本回合薩維爾每次攻擊時，額外造成 1 點[直傷]。',
    *play(g, u) {
      u.ap += 5;
      g.log('薩達莉亞的餘燼：+5 AP', u.owner);
      g.addCounter(u, E, 1);
      g.log('本回合薩維爾每次攻擊額外造成 1 點[直傷]', u.owner);
      schedule(g, u);
    },
  },
];

const saviel: CharDef = {
  id: 'saviel',
  name: '薩維爾',
  title: '直擊、連擊、小破',
  theme: '#6fb6ea',
  lore: '本該是火神的下一位繼承人，卻因魔力與眾不同，而丟失了繼承權，並被流放，在外流浪的同時，也在尋找證明自身價值的機會。具有特殊的技巧，隨著不斷的進攻，帶來更高的火力。',
  hp: 40, ap: 6, tp: 6, at: 1, atkCost: 0, sp: 0,
  counters: [
    { id: F, name: '焰能' },
    { id: C, name: '連擊' },
    { id: B, name: '焰勢', hidden: true },
    { id: E, name: '餘燼', hidden: true },
    { id: D, name: '首擊', hidden: true },
    { id: S, name: '已排程', hidden: true },
  ],
  keywords: {
    焰能: '薩維爾的資源，上限 6 層，回合結束清空。每 1 層＝本回合可以[主動攻擊] 1 次（主動攻擊不花 AP，改消耗 1 層焰能）。',
    連擊: '本回合已經[打擊]幾次（主動攻擊、卡牌打擊、多段打擊的每一段都算）。卡牌上的 [連擊 X]：打出時本回合剛好已打擊 X 次才發動（[連擊 0]＝這回合還沒攻擊過）；能力的 [連擊 X]：第 X 次打擊時發動。',
  },
  abilities: [
    { id: 'p1', active: false, name: '焰之繼承', text: '薩維爾的[打擊]一律視為[直擊]（造成傷害，但不會減少對方 TP）。' },
    { id: 'p2', active: false, name: '焰能', text: '[主動攻擊]不花 AP，改為消耗 1 [焰能]；[焰能] 每 1 層 = 本回合可主動攻擊 1 次（上限 6 層，回合結束清空）。' },
    { id: 'p3', active: false, name: '先鋒', text: '每回合首次[主動攻擊]時，自身抽 1 張牌。' },
    { id: 'p4', active: false, name: '連擊', text: '當[連擊 3、4、5] 下一次攻擊 AT +1（不可疊加）。當[連擊 6] 本次傷害 ×2。' },
  ],
  deck: [
    ['svi_instant', 6], ['svi_draw', 3], ['svi_load', 3],
    ['svi_wanted', 2], ['svi_ring', 2], ['svi_ember', 1],
  ],
  hooks: {
    /** 焰能層數 = 本回合可主動攻擊次數（已打過的次數加上剩下的焰能） */
    attackLimit: (g, u) => u.attacksThisTurn + g.counter(u, F),
    attackApCost: () => 0,
    canAttack: (g, u) => g.counter(u, F) >= 1,
    onAttack(g, u) {
      g.addCounter(u, F, -1);
      schedule(g, u);
      if (!g.counter(u, D)) {
        g.addCounter(u, D, 1);
        g.draw(u, 1, true);
        g.log('[薩維爾] 本回合首次主動攻擊，抽 1 張牌', u.owner);
      }
    },
    atBonus: (g, u) => g.counter(u, B),
    /** 主動攻擊也是[直擊]，並在[連擊 6]時傷害 ×2 */
    strikeOpts(g, u) {
      const base = g.effAt(u);
      return { direct: true, power: g.counter(u, C) + 1 === 6 ? base * 2 : base };
    },
    onAttackHit(g, u, t, dmg) {
      afterHit(g, u, t, dmg, g.counter(u, C) + 1 === 6);
    },
    onTurnStartBeforeDraw(g, u) {
      // 上一個「下回合 -1 AT」到這裡結束
      for (const e of g.enemiesOf(u.owner)) {
        const n = g.counter(e, N);
        if (!n) continue;
        e.at += n;
        g.addCounter(e, N, -n);
        g.log(`${e.name} 的 AT 回復 ${n}（-1 AT 結束）`, u.owner);
      }
    },
  },
};

registerChar(saviel, cards);

// 回合結束：清空[焰能]、[連擊]與本回合的標記
registerEndOfTurn(TURN_END, (g, by) => {
  const u = by;
  for (const id of [F, C, B, E, D, S]) {
    const n = g.counter(u, id);
    if (n) g.addCounter(u, id, -n);
  }
  for (const e of g.enemiesOf(u.owner)) {
    const n = g.counter(e, W);
    if (n) g.addCounter(e, W, -n);
  }
  g.log(`[薩維爾] 回合結束：[焰能]、[連擊] 清空`, u.owner);
});
