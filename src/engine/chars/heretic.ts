import { registerChar, registerStatus, type CardDef, type CharDef, type PlayPay } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 異端物：手牌即資源、掃場、改寫現實（18 張）
// =====================================================================

const MODE = 'mode';       // 已選的型態：0 未定、1 異方侵入、2 超越此方
const INTRUDE = 'intrude'; // [異方侵入]
const BEYOND = 'beyond';   // [超越此方]
const FIRST = 'firstHS';   // 本回合是否已經觸發過能力 3（首次移除手牌）

const VERDICT = 'her_verdict'; // 【臨界點的裁決】
const VERDICT_COST = 11;

/**
 * 進入型態（[異方侵入]／[超越此方]）。
 * 一場只能選一次：臨界點的裁決打出後就決定了。
 */
function enterMode(g: Game, u: Unit, mode: 1 | 2) {
  if (g.counter(u, MODE) > 0) return;
  g.addCounter(u, MODE, mode);
  if (mode === 1) {
    g.addCounter(u, INTRUDE, 1);
    g.log('[異端物] 進入[異方侵入]：每個自身回合開始改為抽 3 張，並可以使用[主動攻擊]', u.owner);
    g.fx({ t: 'status', unitId: u.id, text: '異方侵入' });
    return;
  }
  g.addCounter(u, BEYOND, 1);
  const mate = g.teammate(u);
  // 能力 5：最大 HP 設為 20，HP 與隊友綁定；TP 以隊友為基準
  u.maxHp = 20;
  if (u.hp > u.maxHp) u.hp = u.maxHp;
  u.hpLink = mate.id;
  mate.hpLink = u.id;
  u.tpLink = mate.id;
  // 隊友：最大 TP +2、AT +1
  mate.tpMax += 2;
  mate.at += 1;
  u.tpMax = mate.tpMax;
  u.tp = Math.min(u.tpMax, mate.tp);
  g.log(`[異端物] 進入[超越此方]：最大 HP 設為 20、HP 與 ${mate.name} 綁定、TP 以 ${mate.name} 為基準`, u.owner);
  g.log(`${mate.name} 最大 TP +2（${mate.tpMax}）、AT +1（${mate.at}）`, u.owner);
  g.fx({ t: 'status', unitId: u.id, text: '超越此方' });
  g.fx({ t: 'status', unitId: mate.id, text: '最大TP+2・AT+1' });
}

/**
 * 【臨界點的裁決】回合開始強制打出：我方湊得出 11 張手牌（不含這張）就直接打出。
 * 付費和一般出牌一樣由玩家自己選要移除誰的哪幾張牌（專案擁有者確認），所以型態也是玩家決定的。
 */
function* autoVerdict(g: Game, u: Unit) {
  if (g.counter(u, MODE) > 0) return;
  const verdict = u.hand.find(c => c.defId === VERDICT);
  if (!verdict || g.handAvail(u) - 1 < VERDICT_COST) return;
  g.log(`${u.name} 回合開始，直接打出【臨界點的裁決】`, u.owner);
  yield* g.playFromHand(u, verdict.uid);
}

const cards: CardDef[] = [
  {
    id: 'her_intrude', charId: 'heretic', name: '侵入', cost: 1,
    text: '自身抽 1 張牌。',
    *play(g, u) {
      g.draw(u, 1);
    },
  },
  {
    id: 'her_beyond', charId: 'heretic', name: '超越', cost: 1,
    text: '隊友抽 1 張牌。',
    *play(g, u) {
      g.draw(g.teammate(u), 1);
    },
  },
  {
    id: 'her_tear', charId: 'heretic', name: '撕裂現實', cost: 3,
    text: '使 1 名我方單位[居前]，且該單位受到傷害 -1，直到該單位下個回合開始。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '撕裂現實：選 1 名我方單位[居前]');
      if (!t) return;
      t.spBonus += 1;
      t.dmgReduce += 1;
      g.log(`${t.name} [居前]（SP +1），受到傷害 -1，直到其下個回合開始`, u.owner);
      g.fx({ t: 'status', unitId: t.id, text: 'SP+1・減傷1' });
    },
  },
  {
    id: 'her_shatter', charId: 'heretic', name: '粉碎幻境', cost: 3,
    text: '我方每名單位從自己的棄牌區[檢索] 1 張牌，然後回復我方全體 3 HP。',
    *play(g, u) {
      for (const a of g.allies(u)) {
        if (!a.discard.length) continue;
        yield* g.searchDiscard(a, `粉碎幻境：${a.name} 從棄牌區檢索 1 張牌`);
      }
      for (const a of g.allies(u)) g.heal(a, 3);
    },
  },
  {
    id: 'her_desire', charId: 'heretic', name: '欲望與解析', cost: 5,
    text: '指定 1 名我方單位。如果指定自身：吸取隊友 6 HP，自身抽 1 張牌。如果指定隊友：該單位抽 1 張牌、[洗牌]，獲得[臨時TP] 2。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '欲望與解析：指定 1 名我方單位');
      if (!t) return;
      if (t === u) {
        const mate = g.teammate(u);
        if (mate.life === 'alive') {
          g.log(`${u.name} 吸取 ${mate.name} 6 HP`, u.owner);
          g.payHp(mate, 6);
          g.heal(u, 6);
        }
        g.draw(u, 1);
      } else {
        g.draw(t, 1);
        g.abilityShuffle(t);
        t.tTp += 2;
        g.log(`${t.name} 獲得臨時 2 TP`, u.owner);
        g.fx({ t: 'status', unitId: t.id, text: '臨時TP+2' });
      }
    },
  },
  {
    id: VERDICT, charId: 'heretic', name: '臨界點的裁決', cost: VERDICT_COST,
    text: '（回合開始時，如果我方湊得出 11 張手牌，則直接打出）花費的牌多來自自身時，以[異方侵入]打出；多來自隊友時，以[超越此方]打出。使用後[移出牌局]。',
    removeAfterPlay: true,
    *play(g, u, pay?: PlayPay) {
      const own = pay?.handPaid?.find(x => x.unitId === u.id)?.n ?? 0;
      const mate = (pay?.handPaid ?? []).filter(x => x.unitId !== u.id).reduce((s, x) => s + x.n, 0);
      enterMode(g, u, own > mate ? 1 : 2);
    },
  },
];

const heretic: CharDef = {
  id: 'heretic',
  name: '異端物',
  title: '手牌即資源、掃場、改寫現實',
  theme: '#b4519e',
  lore: '在世界的夾縫中窺視著萬物，進而不斷學習的精神體。隨著理解與它接觸的人事物，慢慢地產生了各種欲望；但對於這個世界來說究竟是禍還是福，就只能看它是如何滿足慾望的了。具有不同於這個世界的能力，能夠改寫現實，且隨著自身的本能慾望和對於這個世界的理解，異端物的性質會逐漸改變。',
  hp: 40, ap: 0, tp: 6, at: 0, atkCost: 0, sp: 0,
  costAs: 'hand',
  forms: [{ id: 'intrude', name: '異方侵入', counter: INTRUDE }, { id: 'beyond', name: '超越此方', counter: BEYOND }], // 型態立繪
  attackCostText: '全手牌',
  atText: 'AT X（＝掃場移除的手牌數）',
  counters: [
    { id: MODE, name: '型態', hidden: true },
    { id: FIRST, name: '本回合已移除', hidden: true },
    { id: INTRUDE, name: '異方侵入', hidden: true },
    { id: BEYOND, name: '超越此方', hidden: true },
  ],
  keywords: {
    HS: '手牌數。異端物不使用 AP：打出卡牌時改為從我方手牌[移除]等於費用的張數（可以付自己的，也可以付隊友的）。',
    異方侵入: '異端物的型態之一（由【臨界點的裁決】決定）：每個自身回合開始的[起手抽牌]改為抽 3 張，並且可以使用[主動攻擊]。',
    超越此方: '異端物的型態之一（由【臨界點的裁決】決定）：每個自身回合開始，隊友的[起手抽牌]改為從牌堆[檢索] 1 張牌。異端物最大 HP 設為 20、HP 與隊友綁定、TP 以隊友為基準；隊友最大 TP +2、AT +1。',
  },
  abilities: [
    { id: 'p1', active: false, name: '異端計費', text: '異端物不使用 AP：打出卡牌時，從我方手牌[移除]等於費用的張數。' },
    { id: 'p2', active: false, name: '現實改寫', text: '[主動攻擊]：移除自身所有手牌，對敵方全場造成等於移除張數的[直傷]，隨後異端物本回合停止行動。' },
    { id: 'p3', active: false, name: '解析本能', text: '我方每回合首次移除手牌時，被移除手牌的單位各抽回同等張數的牌。' },
    { id: 'p4', active: false, name: '尚未定型', text: '打出[異方侵入]前，異端物不能[主動攻擊]。' },
    { id: 'p5', active: false, name: '慾望的形狀', text: '打出[超越此方]後：自身最大 HP 設為 20、HP 與隊友綁定、TP 以隊友為基準；隊友最大 TP +2、AT +1。' },
  ],
  deck: [
    ['her_intrude', 4], ['her_beyond', 4], ['her_tear', 3],
    ['her_shatter', 3], ['her_desire', 3], [VERDICT, 1],
  ],
  hooks: {
    /** 能力 4：打出[異方侵入]前不能主動攻擊 */
    canAttack: (g, u) => g.counter(u, INTRUDE) > 0 || '打出[異方侵入]前不能主動攻擊',
    attackApCost: () => 0,
    /** 能力 2：掃場——移除自身所有手牌，對敵方全場造成同等張數的[直傷]，然後停止行動 */
    *attack(g, u) {
      const n = u.hand.length;
      if (n) {
        g.millHand(u, u.hand.map(c => c.uid));
        g.handRemoved(u, [{ unitId: u.id, n }]);
      }
      g.log(`${u.name} 改寫現實：移除 ${n} 張手牌，對敵方全場造成 ${n} 點[直傷]`, u.owner);
      for (const t of g.enemiesOf(u.owner)) g.dealHp(t, n);
      u.noActionTurn = true;
      g.log(`${u.name} 本回合停止行動`, u.owner);
      g.fx({ t: 'status', unitId: u.id, text: '停止行動' });
      return true;
    },
    /** 能力 1 的[異方侵入]：自己的[起手抽牌]改為 3 張 */
    turnStartDraw: (g, u) => (g.counter(u, INTRUDE) > 0 ? 3 : 1),
    /** 能力 5 的[超越此方]：隊友的[起手抽牌]改成從牌堆檢索 1 張 */
    *onAllyStartDraw(g, u, ally) {
      if (g.counter(u, BEYOND) === 0 || ally === u) return false;
      if (!ally.deck.length) return false;
      yield* g.searchDeck(ally, '超越此方：從牌堆檢索 1 張牌');
      return true;
    },
    /** 能力 3：我方每回合首次移除手牌時，被移除的單位各抽回同等張數 */
    onHandRemoved(g, u, removals) {
      if (g.state.active !== u.owner) return;
      if (g.counter(u, FIRST) > 0) return;
      g.addCounter(u, FIRST, 1);
      const parts: string[] = [];
      for (const r of removals) {
        if (r.n <= 0) continue;
        const x = g.unit(r.unitId);
        if (x.life === 'dead') continue;
        g.draw(x, r.n);
        parts.push(`${x.name} 抽 ${r.n} 張`);
      }
      if (parts.length) g.log(`[異端物] 本回合首次移除手牌：${parts.join('、')}`, u.owner);
    },
    *onTurnStartBeforeDraw(g, u) {
      const n = g.counter(u, FIRST);
      if (n) g.addCounter(u, FIRST, -n);
      yield* autoVerdict(g, u);
    },
  },
};

registerStatus({ id: INTRUDE, name: '異方侵入' });
registerStatus({ id: BEYOND, name: '超越此方' });

registerChar(heretic, cards);
