import { registerChar, registerEndOfTurn, registerStatus, registerTrigger, type CardDef, type CharDef, type ReactionCtx } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 異教容器 休姆：TP 沒有上限、在[瀕死]徘徊、坦、大破、控場（17 張）
// =====================================================================

const PARDON = 'pardon';     // [赦免]（最多 10 層，超過的部分改為 +1 TP）
const CUT = 'pardonCut';     // 最後一次用[赦免]減傷／減少扣 TP 的回合（state.turn）
const SIN = 'sin';           // [罪人]：掛在單位身上的狀態
const ACCUSED = 'accused';   // 【無端指控】扣掉的 SP（本回合結束時還原）
const SIN_ASK = 'hume_sin';  // 延後觸發：能力 5 的「給予[罪人]」

const PARDON_MAX = 10;

/** 目前[赦免]層數 */
const pardon = (g: Game, u: Unit) => g.counter(u, PARDON);

/** 可以指定「1 名單位」的目標：存活或[瀕死]都可以，敵我皆可（不含[死亡]） */
const anyUnits = (g: Game) => g.allUnits().filter(x => x.life !== 'dead');

/** 有[罪人]的單位（存活或[瀕死]） */
const sinful = (g: Game) => anyUnits(g).filter(x => g.counter(x, SIN) > 0);

/** +[赦免]：超過 10 層的部分，每多 1 層改為 +1 TP */
function gainPardon(g: Game, u: Unit, n: number) {
  if (n <= 0) return;
  const add = Math.min(n, Math.max(0, PARDON_MAX - pardon(g, u)));
  if (add) {
    g.addCounter(u, PARDON, add);
    g.log(`${u.name} +${add} [赦免]（${pardon(g, u)}／${PARDON_MAX}）`, u.owner);
    g.fx({ t: 'status', unitId: u.id, text: `赦免+${add}` });
  }
  const over = n - add;
  if (over > 0) {
    g.log(`[赦免] 已滿 ${PARDON_MAX} 層：多出來的 ${over} 層改為 +${over} TP`, u.owner);
    g.gainTp(u, over);
  }
}

/** 給予[罪人]（不可疊加） */
function giveSin(g: Game, by: Unit, t: Unit) {
  if (t.life === 'dead') return;
  if (g.counter(t, SIN) > 0) {
    g.log(`${t.name} 已經有[罪人]（不可疊加）`, by.owner);
    return;
  }
  g.addCounter(t, SIN, 1);
  g.log(`${t.name} 被給予[罪人]`, by.owner);
  g.fx({ t: 'status', unitId: t.id, text: '罪人' });
}

/** 解除所有單位的[罪人] */
function clearSin(g: Game, by: Unit) {
  const targets = sinful(g);
  for (const x of targets) g.addCounter(x, SIN, -g.counter(x, SIN));
  if (targets.length) g.log(`解除所有單位的[罪人]（${targets.length} 個單位）`, by.owner);
}

// ---------------------------------------------------------------------
// 能力 5：陷入[瀕死]時給 1 名單位[罪人]、自身 +1 [赦免]。
// 進入[瀕死]發生在同步的 HP 結算裡（不能要求選擇），所以用延後觸發排隊，
// 等目前這個操作（出牌、攻擊、能力、反擊）結算完再問。
// ---------------------------------------------------------------------
registerTrigger(SIN_ASK, function* (g, by) {
  gainPardon(g, by, 1);
  const t = yield* g.chooseUnit(by.owner, `${by.name} 陷入[瀕死]：給予 1 名單位[罪人]`, anyUnits(g));
  if (t) giveSin(g, by, t);
});

// 【無端指控】的 SP -1：到休姆這個回合結束時還原（記在目標身上，休姆中途陣亡也照樣還原）
registerEndOfTurn(ACCUSED, (g, by) => {
  for (const x of g.allUnits()) {
    const n = g.counter(x, ACCUSED);
    if (!n) continue;
    g.addCounter(x, ACCUSED, -n);
    x.spBonus += n;
    g.log(`${x.name} 的 SP 恢復（無端指控結束）`, by.owner);
    g.fx({ t: 'status', unitId: x.id, text: `SP+${n}` });
  }
});

// [罪人]：受到攻擊 +1、不可疊加、該單位自己的回合開始時解除
registerStatus({
  id: SIN, name: '罪人',
  attackTakenBonus: (g, u) => (g.counter(u, SIN) > 0 ? 1 : 0),
  onTurnStart: (g, u) => g.addCounter(u, SIN, -g.counter(u, SIN)),
});

const cards: CardDef[] = [
  {
    id: 'hum_judge', charId: 'hume', name: '判教', cost: 1,
    text: '自身 +1 TP，指定 1 名單位，給予其[罪人]。\n[審判] [直擊] 1 名單位；可以額外花費 2 AP，使該單位 -X TP（X ＝ 這次造成的傷害）。',
    *play(g, u) {
      if (u.life !== 'dying') {
        g.gainTp(u, 1);
        const t = yield* g.chooseUnit(u.owner, '判教：指定 1 名單位（給予[罪人]）', anyUnits(g));
        if (t) giveSin(g, u, t);
        return;
      }
      // [審判]：打出時就處於[瀕死]才走這段（之後狀態改變不影響）
      const t = yield* g.chooseUnit(u.owner, '判教[審判]：[直擊] 1 名單位', anyUnits(g));
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      g.log(`${u.name} [審判]【判教】[直擊] ${t.name}`, u.owner);
      const dmg = g.strikeOnce(u, t, { direct: true });
      if (dmg <= 0 || u.ap < 2 || t.life === 'dead') return;
      const ok = yield* g.confirm(u.owner, `判教[審判]：額外花費 2 AP，使 ${t.name} -${dmg} TP 嗎？`, `支付 2 AP`, '不支付');
      if (!ok) return;
      u.ap -= 2;
      g.log(`${u.name} 判教[審判]：${t.name} -${dmg} TP`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: '-2 AP' });
      g.loseTp(t, dmg);
    },
  },
  {
    id: 'hum_accuse', charId: 'hume', name: '無端指控', cost: 1,
    text: '使 1 名單位本回合 SP -1。\n[審判] 指定 1 名單位，給予其[罪人]。',
    *play(g, u) {
      const judged = u.life === 'dying';
      const t = yield* g.chooseUnit(u.owner,
        judged ? '無端指控[審判]：指定 1 名單位（給予[罪人]）' : '無端指控：指定 1 名單位（本回合 SP -1）',
        anyUnits(g));
      if (!t) return;
      if (judged) { giveSin(g, u, t); return; }
      t.spBonus -= 1;
      g.addCounter(t, ACCUSED, 1);
      g.log(`${t.name} 本回合 SP -1（到休姆的回合結束）`, u.owner);
      g.fx({ t: 'status', unitId: t.id, text: 'SP-1' });
      g.state.endOfTurn.push({ kind: ACCUSED, by: u.id });
    },
  },
  {
    id: 'hum_penance', charId: 'hume', name: '苦修', cost: 3,
    text: '指定 1 名單位，該單位以「AT − [赦免]層數」[打擊]休姆，然後給予該單位[罪人]。\n[審判] 所有[罪人]單位[打擊自身]。',
    *play(g, u) {
      if (u.life === 'dying') {
        for (const t of sinful(g)) {
          g.log(`[審判]【苦修】${t.name} [打擊自身]`, u.owner);
          g.strikeSelf(t);
        }
        return;
      }
      const t = yield* g.chooseUnit(u.owner, '苦修：指定 1 名單位（以「AT − [赦免]層數」[打擊]休姆）', anyUnits(g));
      if (!t) return;
      const power = Math.max(0, g.effAt(t) - pardon(g, u));
      g.log(`【苦修】${t.name} 以 ${power} 點傷害[打擊] ${u.name}`, u.owner);
      g.attackHit(t, u, power, true);
      giveSin(g, u, t);
    },
  },
  {
    id: 'hum_doctrine', charId: 'hume', name: '不滅教義', cost: 3,
    text: '自身 +2 TP，抽 2 張牌；每有 2 層[赦免]，再 +1 TP。\n[審判] -5 TP，然後[救治]自身（回到 10 HP），然後抽 1 張牌。',
    canPlay: (_g, u) => (u.life === 'dying' && u.tp <= 5
      ? `[瀕死]且 TP 只剩 ${u.tp}：打出[審判]會先 -5 TP，直接被[處決]`
      : true),
    *play(g, u) {
      if (u.life !== 'dying') {
        g.gainTp(u, 2 + Math.floor(pardon(g, u) / 2));
        g.draw(u, 2);
        return;
      }
      g.loseTp(u, 5);
      if (u.life === 'dying') {
        g.log(`[審判]【不滅教義】${u.name} -5 TP，[救治]自身`, u.owner);
        g.reviveUnit(u, u.maxHp);
      }
      g.draw(u, 1);
    },
  },
  {
    id: 'hum_cleanse', charId: 'hume', name: '洗滌', cost: 4,
    text: '所有[罪人]單位 -X TP（X ＝ [赦免]層數），然後解除所有單位的[罪人]。\n[審判] 休姆以 X 點 AT [打擊]所有[罪人]單位（X ＝ [赦免]層數），然後解除所有單位的[罪人]，-3 [赦免]。',
    *play(g, u) {
      const x = pardon(g, u);
      const judged = u.life === 'dying';
      for (const t of sinful(g)) {
        if (judged) {
          g.log(`[審判]【洗滌】${u.name} 以 ${x} 點 AT [打擊] ${t.name}`, u.owner);
          g.attackHit(u, t, x, true);
        } else {
          g.log(`【洗滌】${t.name} -${x} TP`, u.owner);
          g.loseTp(t, x);
        }
      }
      clearSin(g, u);
      if (!judged) return;
      const n = Math.min(3, pardon(g, u));
      if (!n) return;
      g.addCounter(u, PARDON, -n);
      g.log(`${u.name} -${n} [赦免]（${pardon(g, u)}／${PARDON_MAX}）`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: `赦免-${n}` });
    },
  },
  {
    id: 'hum_martyr', charId: 'hume', name: '殉教', cost: 4, reaction: true,
    text: '[反擊] 取消這次敵方攻擊，然後自身陷入[瀕死]，+2 [赦免]。\n[審判] [反擊] 取消這次敵方攻擊，給予這次攻擊的單位[罪人]。',
    *react(g, u, ctx: ReactionCtx) {
      if (u.life === 'dying') {
        giveSin(g, u, ctx.attacker);
        return;
      }
      g.log(`${u.name} 【殉教】自身陷入[瀕死]`, u.owner);
      g.enterDying(u);
      gainPardon(g, u, 2);
    },
  },
  {
    id: 'hum_allsin', charId: 'hume', name: '萬物皆有罪', cost: 6,
    text: '給予自身和 1 名敵方單位[罪人]，然後自身 +5 AP，[洗牌]。\n當[赦免] ＝ 10：此牌 AP -4，效果改為：給予敵方全體[罪人]，然後自身[洗牌]。',
    costFor: (g, u) => (pardon(g, u) >= PARDON_MAX ? 2 : 6),
    *play(g, u) {
      if (pardon(g, u) >= PARDON_MAX) {
        for (const e of g.enemiesOf(u.owner)) giveSin(g, u, e);
        g.abilityShuffle(u);
        return;
      }
      giveSin(g, u, u);
      const t = yield* g.chooseUnit(u.owner, '萬物皆有罪：指定 1 名敵方單位（給予[罪人]）', g.enemiesOf(u.owner));
      if (t) giveSin(g, u, t);
      u.ap += 5;
      g.log(`${u.name} +5 AP（${u.ap}）`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: '+5 AP' });
      g.abilityShuffle(u);
    },
  },
];

const hume: CharDef = {
  id: 'hume',
  name: '休姆',
  title: '消耗 TP 救治自身、在[瀕死]徘徊、坦、大破、控場',
  theme: '#b8893a',
  lore: '被異教選中的「容器」，用來盛裝世人的一切罪孽。他在儀式裡一次又一次死去，又被赦免從[瀕死]拉回來——教團說那是神蹟，只有他知道那是懲罰。',
  hp: 10, ap: 7, tp: 60, at: 0, atkCost: 2, sp: 0,
  unyielding: true, // 能力 7：[瀕死]時仍可行動、SP 不變
  tpUncapped: true, // 能力 2：TP 沒有上限
  counters: [
    { id: PARDON, name: '赦免', max: PARDON_MAX, onlyPositive: true },
    { id: ACCUSED, name: '本回合SP-1', hidden: true },
    { id: CUT, name: '赦免已用', hidden: true },
  ],
  keywords: {
    罪人: '此單位受到的攻擊傷害 +1（不可疊加）。此單位自己的回合開始時解除。',
    赦免: '每 2 層，自身每回合第一次受到的傷害 -1；[瀕死]時改為：每 2 層，每回合第一次受到攻擊時 TP 的減少量 -1。最多 10 層，超過 10 層時，每多 1 層改為 +1 TP。',
    審判: '如果休姆處於[瀕死]，改為執行[審判]後面的效果（打出這張牌、開始結算時判斷）。',
  },
  abilities: [
    { id: 'p1', active: false, name: '罪孽之身', text: 'HP 小於等於 5 時，判定為[負傷]。' },
    { id: 'p2', active: false, name: '無底的容器', text: '休姆的 TP 沒有上限。' },
    { id: 'p3', active: false, name: '不可處決', text: '休姆 TP 大於 10 時，無法被[處決]。' },
    { id: 'p4', active: false, name: '赦免的循環', text: '回合結束時，如果自身處於[瀕死]，-10 TP，[救治]自身。' },
    { id: 'p5', active: false, name: '盛裝罪孽', text: '休姆陷入[瀕死]時，給予 1 名單位[罪人]，自身 +1 [赦免]。' },
    { id: 'p6', active: false, name: '代罪', text: '自身[瀕死]時，+2 AT，SP +1。' },
    { id: 'p7', active: false, name: '不屈', text: '此單位擁有[不屈]。' },
  ],
  deck: [
    ['hum_judge', 4], ['hum_accuse', 3], ['hum_penance', 2], ['hum_doctrine', 2],
    ['hum_cleanse', 2], ['hum_martyr', 2], ['hum_allsin', 2],
  ],
  hooks: {
    /** 能力 1：HP ≤ 5 也算[負傷] */
    extraWounded: (_g, u) => u.hp <= 5,
    /** 能力 3：TP 大於 10 時擋下[處決] */
    canBeExecuted: (_g, u) => u.tp <= 10,
    /** 能力 6：[瀕死]時 +2 AT、SP +1（[不屈]讓 SP 不會變成 -1） */
    atBonus: (_g, u) => (u.life === 'dying' ? 2 : 0),
    spDelta: (_g, u) => (u.life === 'dying' ? 1 : 0),
    /** 能力 5：進入[瀕死]時排延後觸發（不能在這裡要求選擇） */
    onEnterDying(g, u) {
      g.queueTrigger({ kind: SIN_ASK, by: u.id });
    },
    /** 能力 4：回合結束時[瀕死]且 TP > 10 → -10 TP、以 10 HP [救治]自身（直接扣，不走瀕死扣 TP 流程） */
    onOwnTurnEnd(g, u) {
      if (u.life !== 'dying' || u.tp <= 10) return;
      g.log(`【赦免的循環】${u.name} -10 TP，[救治]自身`, u.owner);
      u.tp -= 10;
      g.fx({ t: 'tp', unitId: u.id, amount: 10 });
      g.reviveUnit(u, u.maxHp);
    },
    /** [赦免]：每 2 層，每回合第一次受到的傷害 -1（雙方的回合各算一次） */
    incomingDamage(g, u, dmg) {
      if (u.life !== 'alive') return dmg;
      const n = Math.floor(pardon(g, u) / 2);
      if (n <= 0 || g.counter(u, CUT) === g.state.turn) return dmg;
      u.counters[CUT] = g.state.turn;
      g.log(`[赦免] ${u.name} 這次受到的傷害 -${n}`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: `傷害-${n}` });
      return dmg - n;
    },
    /** [赦免]（[瀕死]版）：每 2 層，每回合第一次受到攻擊時 TP 的減少量 -1 */
    dyingTpLoss(g, u, loss) {
      const n = Math.floor(pardon(g, u) / 2);
      if (n <= 0 || g.counter(u, CUT) === g.state.turn) return loss;
      u.counters[CUT] = g.state.turn;
      g.log(`[赦免] ${u.name} 這次受到攻擊的 TP 減少量 -${n}`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: `扣TP-${n}` });
      return loss - n;
    },
  },
};

registerChar(hume, cards);
