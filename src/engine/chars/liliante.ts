import { registerChar, type CardDef, type CharDef } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 利利安特：自傷、疊最大 TP、AT 等於 TP、熱血海扁（16 張）
// =====================================================================

const HPL = 'hpLoss';    // 本回合累計損失的 HP（能力 2）
const GREW = 'grew';     // 本回合是否已因能力 2 成長
const GROWN = 'grown';   // 能力 2 已成長的次數（全場最多 6 次）
const WT = 'wt';         // 本回合是否進入過[負傷]（卡牌的「本回合已[負傷]」）
const NEXT = 'nextAtk';  // 下 1 次[主動攻擊] -2 AP

const GROW_MAX = 6;      // 能力 2 最多觸發 6 次
const GROW_HP = 8;       // 一回合內損失 8 HP 就觸發

/** 「本回合已[負傷]」：這回合曾經[負傷]，或現在正處於[負傷] */
const woundedThisTurn = (g: Game, u: Unit) => g.counter(u, WT) > 0 || g.isWounded(u);

/** 能力 2：永久 +1 最大 TP（每回合 1 次、全場最多 6 次） */
function growTp(g: Game, u: Unit) {
  if (g.counter(u, GREW) > 0 || g.counter(u, GROWN) >= GROW_MAX) return;
  g.addCounter(u, GREW, 1);
  g.addCounter(u, GROWN, 1);
  u.tpMax += 1;
  g.log(`[利利安特] 血肉更加強韌：永久最大 TP +1（${g.counter(u, GROWN)}／${GROW_MAX}）`, u.owner);
  g.fx({ t: 'status', unitId: u.id, text: '最大TP+1' });
}

/** 「下 1 次[主動攻擊] -2 AP」 */
function nextAttackDown(g: Game, u: Unit) {
  g.addCounter(u, NEXT, 1);
  g.log('利利安特下 1 次[主動攻擊] -2 AP', u.owner);
  g.fx({ t: 'status', unitId: u.id, text: '下1次普攻-2' });
}

const cards: CardDef[] = [
  {
    id: 'lil_frenzy', charId: 'liliante', name: '癲狂鬥魂', cost: 1,
    text: '自身 -1 TP，回復 1 HP。如果自身當前[負傷]，改為回復 1 TP、3 HP。',
    *play(g, u) {
      g.loseTp(u, 1);
      if (g.isWounded(u)) {
        g.gainTp(u, 1);
        g.heal(u, 3);
      } else {
        g.heal(u, 1);
      }
    },
  },
  {
    id: 'lil_stop', charId: 'liliante', name: '別停! 別停!', cost: 2,
    text: '[打擊自身]，抽 1 張牌。如果自身當前[負傷]，再回復 1 TP、抽 1 張牌。',
    *play(g, u) {
      g.strikeSelf(u);
      g.draw(u, 1);
      if (g.isWounded(u)) {
        g.gainTp(u, 1);
        g.draw(u, 1);
      }
    },
  },
  {
    id: 'lil_realm', charId: 'liliante', name: '鬥神領域', cost: 3,
    text: '自身 -3 TP；直到下個自身回合開始，自身受到傷害 -1。如果自身本回合已[負傷]，下 1 次[主動攻擊] -2 AP。',
    *play(g, u) {
      g.loseTp(u, 3);
      u.dmgReduce += 1;
      g.log(`${u.name} 受到的傷害 -1，直到下個自身回合開始`, u.owner);
      if (woundedThisTurn(g, u)) nextAttackDown(g, u);
    },
  },
  {
    id: 'lil_more', charId: 'liliante', name: '不夠! 不夠!!', cost: 4,
    text: '[打擊自身] 2 次，[打擊] 1 名敵方單位，抽 2 張牌。',
    *play(g, u) {
      g.strikeSelf(u, 2);
      const t = yield* g.chooseEnemy(u, '不夠! 不夠!!：選 1 名要[打擊]的敵方單位');
      if (t) g.strikeOnce(u, t);
      g.draw(u, 2);
    },
  },
  {
    id: 'lil_fury', charId: 'liliante', name: '兇絕亂擊', cost: 6,
    text: '（如果自身本回合已[負傷]，此牌 -4 AP）自身 -2 TP、回復 2 HP，下 1 次[主動攻擊] -2 AP。如果自身本回合已[負傷]，改為回復 2 TP。',
    costFor: (g, u) => (woundedThisTurn(g, u) ? 2 : 6),
    *play(g, u) {
      if (woundedThisTurn(g, u)) {
        g.gainTp(u, 2);
      } else {
        g.loseTp(u, 2);
        g.heal(u, 2);
      }
      nextAttackDown(g, u);
    },
  },
  {
    id: 'lil_run', charId: 'liliante', name: '別想跑!!!', cost: 6,
    text: '（如果自身本回合已[負傷]，此牌 -4 AP）自身 -2 TP，無條件指定 1 名敵方單位 SP +1，下 1 次[主動攻擊] -2 AP。如果自身本回合已[負傷]，改為回復 2 TP。',
    costFor: (g, u) => (woundedThisTurn(g, u) ? 2 : 6),
    *play(g, u) {
      const t = yield* g.chooseUnit(u.owner, '別想跑!!!：無條件指定 1 名敵方單位（SP +1）', g.enemiesOf(u.owner));
      if (!t) return;
      if (woundedThisTurn(g, u)) {
        g.gainTp(u, 2);
      } else {
        g.loseTp(u, 2);
      }
      t.spBonus += 1;
      g.log(`${t.name} SP +1`, u.owner);
      g.fx({ t: 'status', unitId: t.id, text: 'SP+1' });
      nextAttackDown(g, u);
    },
  },
  {
    id: 'lil_death', charId: 'liliante', name: '承此亦死', cost: 8,
    text: '（如果自身本回合已[負傷]，此牌 -4 AP）無條件[打擊] 1 名敵方單位，再使該單位 -X TP（X＝自身當前損失的 TP）。之後如果自身本回合已[負傷]，回復 2 TP。',
    costFor: (g, u) => (woundedThisTurn(g, u) ? 4 : 8),
    *play(g, u) {
      const wounded = woundedThisTurn(g, u);
      const lost = Math.max(0, g.effTpMax(u) - u.tp);
      const t = yield* g.chooseUnit(u.owner, '承此亦死：無條件指定 1 名敵方單位', g.enemiesOf(u.owner));
      if (!t) return;
      g.log(`${u.name} 承此亦死：打擊 ${t.name}`, u.owner);
      g.strikeOnce(u, t);
      if (lost) {
        g.log(`${t.name} -${lost} TP（利利安特損失的 TP）`, u.owner);
        g.loseTp(t, lost);
      }
      if (wounded) g.gainTp(u, 2);
    },
  },
];

const liliante: CharDef = {
  id: 'liliante',
  name: '利利安特',
  title: '自傷、疊 TP、TP 即 AT、熱血海扁',
  theme: '#b8402f',
  lore: '極度好戰且瘋狂的鬥士，為了不斷的鑄鍊自身的肉體和錢財，以傭兵之名在各地流浪。擁有不斷戰鬥肉體就會越來越強大的特殊體質，不顧後果的進攻，是他唯一的戰鬥守則。',
  hp: 50, ap: 8, tp: 4, at: 0, atkCost: 4, sp: 0,
  atText: 'AT X（＝當前 TP）',
  unyielding: true, // [不屈]：瀕死時仍可行動、SP 不變
  /** [救治]耗費減半：隊友 TP × 2 的一半 */
  rescueCost: (_g, _u, ally) => ally.tp,
  counters: [
    { id: GROWN, name: '成長' },
    { id: HPL, name: '本回合損失HP', hidden: true },
    { id: GREW, name: '本回合已成長', hidden: true },
    { id: WT, name: '本回合負傷', hidden: true },
    { id: NEXT, name: '下1次普攻-2', hidden: true },
  ],
  keywords: {
    打擊自身: '對自己[打擊]：造成自身 AT 的傷害並 -1 TP。利利安特對自身造成的傷害減半（無條件捨去），也不計算[負傷]的額外增傷。',
  },
  abilities: [
    { id: 'p1', active: false, name: '狂戰', text: '【利利安特】的 AT 等於當前 TP，而且[主動攻擊]不受次數限制。' },
    { id: 'p2', active: false, name: '血肉鑄鍊', text: '一回合內損失 8 HP，或進入[負傷]時，永久 +1 最大 TP（每回合 1 次，最多 6 次）。' },
    { id: 'p3', active: false, name: '嗜戰', text: '每回合有單位（敵我皆算）進入[負傷]時，回復 3 AP。' },
    { id: 'p4', active: false, name: '傭兵急救', text: '【利利安特】的[救治]耗費減半。' },
    { id: 'p5', active: false, name: '痛覺鈍化', text: '【利利安特】對自身造成的傷害減半（無條件捨去），且不計算額外的增傷。' },
    { id: 'p6', active: false, name: '不屈', text: '此單位擁有[不屈]。' },
  ],
  deck: [
    ['lil_frenzy', 4], ['lil_stop', 3], ['lil_realm', 2], ['lil_more', 2],
    ['lil_fury', 2], ['lil_run', 2], ['lil_death', 1],
  ],
  hooks: {
    /** 能力 1：AT 等於當前 TP；[主動攻擊]不限次數 */
    atBonus: (_g, u) => u.tp,
    attackLimit: () => Number.POSITIVE_INFINITY,
    /** 下 1 次[主動攻擊] -2 AP */
    attackApCost: (g, u) => Math.max(0, u.atkCost - (g.counter(u, NEXT) > 0 ? 2 : 0)),
    onAttack(g, u) {
      const n = g.counter(u, NEXT);
      if (n) g.addCounter(u, NEXT, -n);
    },
    /** 能力 2：一回合內損失 8 HP，或進入[負傷]時，永久 +1 最大 TP */
    onHpLoss(g, u, n) {
      g.addCounter(u, HPL, n);
      if (g.counter(u, HPL) >= GROW_HP) growTp(g, u);
    },
    /** 能力 2 的[負傷]觸發；能力 3：任一單位進入[負傷]就 +3 AP */
    onUnitWounded(g, u, t) {
      if (t === u) {
        g.addCounter(u, WT, 1);
        growTp(g, u);
      }
      u.ap = Math.min(u.apMax, u.ap + 3);
      g.log(`[利利安特] 有單位進入[負傷]，回復 3 AP`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: 'AP+3' });
    },
    onTurnStartBeforeDraw(g, u) {
      for (const id of [HPL, GREW, WT]) {
        const n = g.counter(u, id);
        if (n) g.addCounter(u, id, -n);
      }
    },
    /** 能力 5：自傷減半（無條件捨去），且不計算[負傷]的額外增傷 */
    selfHit: (g, u) => ({ power: Math.floor(g.effAt(u) / 2), noWoundBonus: true }),
  },
};

registerChar(liliante, cards);
