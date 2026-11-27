import { registerChar, CARD_DEFS, type CardDef, type CharDef } from '../defs';
import type { Game } from '../game';
import type { AttackCtx, Unit } from '../types';

// =====================================================================
// 泰坦後裔 八重：攻擊翻牌（[拔]）、每 3 次攻擊（[破]）、換兵器（17 張）
// =====================================================================

const ATK = 'atk';     // 本回合攻擊次數（自己的回合開始歸零）
const BRK = 'brk';     // 下一次攻擊強制觸發[破]（泰坦之心、無方(3)）
const PULL3 = 'p3';    // 下一次攻擊的[拔]只翻 1 張、觸發 3 次（無方(1)）
const ATUP = 'atUp';   // 下一次攻擊 +N AT（無方(2)）

/** 回復 AP：可以超過 AP 上限（和薩維爾的 +AP 一樣） */
function gainAp(g: Game, u: Unit, n: number, why: string) {
  u.ap += n;
  g.log(`${u.name} ${why}：+${n} AP（${u.ap}）`, u.owner);
  g.fx({ t: 'status', unitId: u.id, text: `+${n} AP` });
}

/** 赤山：回復這次攻擊實際造成的 HP 傷害 */
function healByDealt(g: Game, u: Unit, atk: AttackCtx, times: number) {
  const n = atk.dealt * times;
  if (n > 0) g.heal(u, n);
}

/** [拔]：傷害前的修正（例如「本次傷害為[直傷]」） */
const PULL_PRE: Record<string, (g: Game, u: Unit, atk: AttackCtx) => void> = {
  yae_tachi: (_g, _u, atk) => { atk.fixed = true; },
};

/** [破]：傷害前的修正 */
const BREAK_PRE: Record<string, (g: Game, u: Unit, atk: AttackCtx) => void> = {
  yae_tachi: (_g, _u, atk) => { atk.fixed = true; atk.power += 2; },
  yae_axe: (_g, _u, atk) => { atk.power += 1; },
};

/** [拔]：主要傷害之後的追加效果。times = 觸發次數（無方(1) 是 3 次） */
const PULL_POST: Record<string, (g: Game, u: Unit, atk: AttackCtx, times: number) => void> = {
  yae_blade: (g, u, atk, times) => {
    for (let i = 0; i < times; i++) if (atk.target) g.strikeOnce(u, atk.target, { direct: true });
  },
  yae_hammer: (g, _u, atk, times) => {
    if (atk.target) g.loseTp(atk.target, 2 * times);
  },
  yae_bow: (g, _u, atk, times) => {
    if (atk.target) g.dealHp(atk.target, 1 * times);
  },
  yae_axe: (g, u, atk, times) => healByDealt(g, u, atk, times),
  yae_void: (g, u, _atk, times) => { for (let i = 0; i < times; i++) gainAp(g, u, 2, '無方[拔]'); },
};

/** [破]：主要傷害之後的追加效果 */
const BREAK_POST: Record<string, (g: Game, u: Unit, atk: AttackCtx) => void> = {
  yae_blade: (g, _u, atk) => {
    if (atk.target) g.strike(atk.u, atk.target, 2, { direct: true });
  },
  yae_hammer: (g, _u, atk) => {
    if (atk.target) g.loseTp(atk.target, 3);
  },
  yae_bow: (g, _u, atk) => {
    if (atk.target) g.dealHp(atk.target, 3);
  },
  yae_axe: (g, u, atk) => healByDealt(g, u, atk, 1),
};

const cards: CardDef[] = [
  {
    id: 'yae_heart', charId: 'yae', name: '泰坦之心', cost: 2,
    text: '抽 1 張牌，下一次攻擊觸發[破]。',
    *play(g, u) {
      g.draw(u, 1);
      g.addCounter(u, BRK, 1);
      g.log(`${u.name} 的下一次攻擊觸發[破]`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: '下次攻擊[破]' });
    },
  },
  {
    id: 'yae_blade', charId: 'yae', name: '三合', cost: 2, tag: '刀',
    text: '[打擊] 1 名敵方單位，本次傷害 -1 AT。[拔]：對同一目標追加 1 次[直擊]。[破]：對同一目標追加 2 次[直擊]。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '三合：選 1 名敵方單位[打擊]');
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      const atk = yield* g.beginAttack(u, 'yae_blade');
      atk.power = Math.max(0, atk.power - 1);
      g.log(`${u.name} 揮刀【三合】[打擊] ${t.name}`, u.owner);
      g.attackStrike(atk, t);
      yield* g.endAttack(atk);
    },
  },
  {
    id: 'yae_hammer', charId: 'yae', name: '真鳴', cost: 2, tag: '槌',
    text: '[打擊] 1 名敵方單位，自身 -2 HP。[拔]：目標追加 -2 TP。[破]：目標追加 -3 TP。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '真鳴：選 1 名敵方單位[打擊]');
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      const atk = yield* g.beginAttack(u, 'yae_hammer');
      g.log(`${u.name} 巨槌【真鳴】[打擊] ${t.name}`, u.owner);
      g.attackStrike(atk, t);
      yield* g.endAttack(atk);
      g.payHp(u, 2); // 損失 HP，不是受到傷害
    },
  },
  {
    id: 'yae_bow', charId: 'yae', name: '長歌', cost: 2, tag: '弓',
    text: '[打擊] 1 名敵方單位，然後[移除] 1 張自己的手牌。[拔]：目標追加 1 點[直傷]。[破]：目標追加 3 點[直傷]。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '長歌：選 1 名敵方單位[打擊]');
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      const atk = yield* g.beginAttack(u, 'yae_bow');
      g.log(`${u.name} 放箭【長歌】[打擊] ${t.name}`, u.owner);
      g.attackStrike(atk, t);
      yield* g.endAttack(atk);
      if (!u.hand.length) return;
      const pick = yield* g.chooseHandCards(u, '長歌：選 1 張自己的手牌[移除]至棄牌區', 1, 1);
      const n = g.millHand(u, pick);
      if (n) g.handRemoved(u, [{ unitId: u.id, n }]);
    },
  },
  {
    id: 'yae_prep', charId: 'yae', name: '備', cost: 2,
    text: '抽 2 張牌，+1 [臨時TP]。',
    *play(g, u) {
      g.draw(u, 2);
      u.tTp += 1;
      g.log(`${u.name} 獲得臨時 1 TP`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: '臨時TP+1' });
    },
  },
  {
    id: 'yae_tachi', charId: 'yae', name: '無念斷', cost: 4, tag: '太',
    text: '[打擊]全體敵方單位，抽 1 張牌。[拔]：本次傷害為[直傷]。[破]：本次傷害為[直傷]，且 +2 AT。',
    *play(g, u) {
      const atk = yield* g.beginAttack(u, 'yae_tachi');
      g.log(`${u.name} 太刀橫掃【無念斷】：[打擊]全體敵方單位`, u.owner);
      for (const t of g.enemiesOf(u.owner)) g.attackStrike(atk, t);
      yield* g.endAttack(atk);
      g.draw(u, 1);
    },
  },
  {
    id: 'yae_axe', charId: 'yae', name: '赤山', cost: 4, tag: '斧',
    text: '[打擊] 1 名單位（敵方或我方，不含自己），本次傷害 +1 AT。[拔]：自身回復這次攻擊造成的 HP 傷害。[破]：回復同樣的 HP，且本次傷害再 +1 AT。',
    *play(g, u) {
      const targets = [...g.attackTargets(u), ...g.allies(u).filter(a => a !== u && a.life === 'alive')];
      const t = yield* g.chooseUnit(u.owner, '赤山：選 1 名單位[打擊]（敵方或我方，不含自己）', targets);
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      const atk = yield* g.beginAttack(u, 'yae_axe');
      atk.power += 1;
      g.log(`${u.name} 巨斧【赤山】[打擊] ${t.name}`, u.owner);
      g.attackStrike(atk, t);
      yield* g.endAttack(atk);
    },
  },
  {
    id: 'yae_void', charId: 'yae', name: '無方', cost: 7,
    text: '+5 AP、自身 -2 TP，然後選 1 項：(1) 下次攻擊[拔]觸發 3 次；(2) 下次攻擊 +3 AT；(3) 選最多 2 張攻擊牌，各自費用 -1 AP，且下次攻擊觸發[破]；(4) [處決] 1 名[瀕死]的敵方單位。之後自身[洗牌]，再選 1 張手牌放到牌庫頂。[拔]：回復 2 AP。',
    *play(g, u) {
      gainAp(g, u, 5, '打出【無方】');
      g.loseTp(u, 2);
      const canDiscount = u.hand.some(c => !!CARD_DEFS[c.defId].tag);
      const dying = g.enemiesOf(u.owner).filter(e => e.life === 'dying');
      const labels = ['下次攻擊[拔]觸發 3 次', '下次攻擊 +3 AT'];
      if (canDiscount) labels.push('選最多 2 張攻擊牌：各自費用 -1 AP，且下次攻擊觸發[破]');
      if (dying.length) labels.push('[處決] 1 名[瀕死]的敵方單位');
      const i = yield* g.option(u.owner, '無方：選 1 項', labels);
      if (i === 0) {
        g.addCounter(u, PULL3, 1);
        g.log(`${u.name} 的下一次攻擊：[拔]觸發 3 次`, u.owner);
        g.fx({ t: 'status', unitId: u.id, text: '[拔]×3' });
      } else if (i === 1) {
        g.addCounter(u, ATUP, 3);
        g.log(`${u.name} 的下一次攻擊 +3 AT`, u.owner);
        g.fx({ t: 'status', unitId: u.id, text: '下次攻擊 +3 AT' });
      } else if (dying.length && i === labels.length - 1) {
        const t = yield* g.chooseUnit(u.owner, '無方：選 1 名[瀕死]的敵方單位[處決]', dying);
        if (t) {
          g.log(`${u.name} 【無方】[處決] ${t.name}！`, u.owner);
          g.executeUnit(t);
        }
      } else {
        const picks = yield* g.chooseCardsFrom([u], '無方：選最多 2 張手牌裡的攻擊牌（各自費用 -1 AP）', 0, 2,
          c => !!CARD_DEFS[c.defId].tag);
        const names: string[] = [];
        for (const uid of picks) {
          const c = u.hand.find(x => x.uid === uid);
          if (!c) continue;
          c.costMod = (c.costMod ?? 0) - 1;
          names.push(CARD_DEFS[c.defId].name);
        }
        g.addCounter(u, BRK, 1);
        g.log(`${u.name} 的下一次攻擊觸發[破]${names.length ? `；${names.join('、')} 費用 -1 AP` : ''}`, u.owner);
        g.fx({ t: 'status', unitId: u.id, text: '下次攻擊[破]' });
      }
      g.abilityShuffle(u);
      if (!u.hand.length) return;
      const pick = yield* g.chooseHandCards(u, '無方：選 1 張手牌放到牌庫頂', 1, 1);
      if (pick.length) g.putHandOnDeckTop(u, pick[0]);
    },
  },
];

const yae: CharDef = {
  id: 'yae',
  name: '八重',
  title: '攻擊移除牌、攻擊附帶額外效果、海扁',
  theme: '#d0782f',
  artTone: 'brightness(1.14) contrast(1.06) saturate(1.05)', // 畫風偏暗紅，在暗色牌桌上會糊在一起：略提亮
  lore: '古代泰坦的後裔，體內流著巨人的血，背著刀、槌、弓、太刀、斧五把祖傳兵器四處征戰。每一次揮擊都會喚醒下一把兵器沉睡的力量——拔出的是兵器，打破的是極限。',
  hp: 45, ap: 8, tp: 7, at: 3, atkCost: 3, sp: 0,
  counters: [
    { id: ATK, name: '攻擊', max: 3 },
    { id: BRK, name: '下次攻擊[破]', onlyPositive: true },
    { id: PULL3, name: '下次[拔]×3', onlyPositive: true },
    { id: ATUP, name: '下次AT', onlyPositive: true },
  ],
  keywords: {
    拔: '八重每次攻擊（普攻或攻擊牌）時，把牌堆最上方 1 張牌[移除]至棄牌區，並觸發那張牌的[拔]效果。牌堆空了就不翻，也沒有[拔]。',
    破: '八重每個自己回合的第 3、6、9…次攻擊觸發[破]：觸發這次攻擊用的那張牌的[破]效果（普攻的[破]見能力 5）。次數在自己的回合開始時歸零。',
  },
  abilities: [
    { id: 'p1', active: false, name: '拔', text: '八重每次攻擊時，先把牌堆最上方 1 張牌[移除]至棄牌區，並觸發那張牌的[拔]效果（普攻也一樣）。牌堆空了就不翻。' },
    { id: 'p2', active: false, name: '破', text: '八重每個自己回合的第 3、6、9…次攻擊觸發[破]：觸發這次攻擊用的那張牌的[破]效果。普攻的[破]見能力 5。次數在自己的回合開始時歸零。' },
    {
      id: 'a3', active: true, name: '架勢', text: '花 1 AP：選 1 張自己的手牌放到牌庫頂。每回合不限次數。',
      canUse: (_g, u) => u.ap >= 1 && u.hand.length > 0,
      *use(g, u) {
        u.ap -= 1;
        const pick = yield* g.chooseHandCards(u, '架勢：選 1 張自己的手牌放到牌庫頂', 1, 1);
        if (pick.length) g.putHandOnDeckTop(u, pick[0]);
      },
    },
    { id: 'p4', active: false, name: '一心', text: '八重的[起手抽牌]只有在回合開始時沒有手牌才抽 1 張；有手牌就不抽。' },
    { id: 'p5', active: false, name: '豪破', text: '八重的[主動攻擊]觸發[破]時，回復 3 AP（可以超過 AP 上限）。' },
  ],
  deck: [
    ['yae_heart', 4], ['yae_blade', 2], ['yae_hammer', 2], ['yae_bow', 2],
    ['yae_prep', 2], ['yae_tachi', 2], ['yae_axe', 2], ['yae_void', 1],
  ],
  hooks: {
    /**
     * 能力 1、2：每次攻擊開始時先套用「下次攻擊 +AT」，累計攻擊次數並判斷[破]，
     * 再翻牌堆最上方的牌觸發[拔]。普攻和攻擊牌都走這裡。
     */
    onAttackStart(g, u, atk) {
      const up = g.counter(u, ATUP);
      if (up) {
        atk.power += up;
        g.addCounter(u, ATUP, -up);
      }
      g.addCounter(u, ATK, 1);
      const n = g.counter(u, ATK);
      const forced = g.counter(u, BRK) > 0;
      if (forced) g.addCounter(u, BRK, -1);
      if (forced || n % 3 === 0) {
        atk.data.brk = 1;
        BREAK_PRE[atk.cardId ?? '']?.(g, u, atk);
        g.fx({ t: 'status', unitId: u.id, text: '破' });
        g.log(`${u.name} 第 ${n} 次攻擊觸發[破]`, u.owner);
      }
      const triple = g.counter(u, PULL3) > 0;
      if (triple) g.addCounter(u, PULL3, -1);
      atk.data.pullTimes = triple ? 3 : 1;
      const milled = g.millTop(u, 1); // 牌堆空了就不翻、也沒有[拔]
      if (!milled.length) return;
      const defId = milled[0].defId;
      atk.data.pull = defId;
      PULL_PRE[defId]?.(g, u, atk);
      g.fx({ t: 'status', unitId: u.id, text: '拔' });
      g.log(`${u.name} [拔]：移除【${CARD_DEFS[defId].name}】${triple ? '，[拔]觸發 3 次' : ''}`, u.owner);
    },
    /** 主要傷害之後：先結算[拔]的追加效果，再結算[破]的追加效果 */
    onAttackEnd(g, u, atk) {
      const pull = atk.data.pull as string | undefined;
      if (pull) PULL_POST[pull]?.(g, u, atk, (atk.data.pullTimes as number) || 1);
      if (!atk.data.brk) return;
      if (!atk.cardId) {
        // 能力 5：普攻觸發[破]＝豪破，回復 3 AP（可以超過上限）
        gainAp(g, u, 3, '[破] 豪破');
        return;
      }
      BREAK_POST[atk.cardId]?.(g, u, atk);
    },
    /** 能力 4：一心——回合開始時有手牌就不抽 */
    turnStartDraw: (_g, u) => (u.hand.length > 0 ? 0 : 1),
    /** 攻擊次數在自己的回合開始時歸零 */
    onTurnStartBeforeDraw(g, u) {
      const n = g.counter(u, ATK);
      if (n) g.addCounter(u, ATK, -n);
    },
  },
};

registerChar(yae, cards);
