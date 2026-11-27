import { registerChar, registerEndOfTurn, type CardDef, type CharDef, type Eff } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 薩凡娜：棄牌、輔助、小破、補牌（17 張）
// =====================================================================

const W = 'wealth';

/** [收買 X]：消耗 X 層財富發動額外效果。ask=false 表示玩家已經按下按鈕，不再詢問 */
function* buy(g: Game, u: Unit, x: number, desc: string, ask = true): Eff<boolean> {
  if (g.counter(u, W) < x) return false;
  if (ask) {
    const ok = yield* g.confirm(u.owner, `【${u.name}】[收買${x}] ${desc}？（目前財富 ${g.counter(u, W)}）`, `發動（-${x} 財富）`, '不發動');
    if (!ok) return false;
  }
  g.addCounter(u, W, -x);
  g.log(`${u.name} [收買${x}]：${desc}`, u.owner);
  CHAR_HOOKS.onBuy(g, u);
  return true;
}

const CHAR_HOOKS = {
  /** 能力 1：每回合（自己的回合）首次觸發[收買]時，隊友抽 1 張牌 */
  onBuy(g: Game, u: Unit) {
    if (g.state.active !== u.owner || u.buyUsedThisTurn) return;
    u.buyUsedThisTurn = true;
    const mate = g.teammate(u);
    if (g.draw(mate, 1, true)) g.log(`[薩凡娜] 本回合首次收買，${mate.name} 抽 1 張牌`, u.owner);
  },
};

const cards: CardDef[] = [
  {
    id: 'sav_stock', charId: 'savanna', name: '武器儲備', cost: 1,
    text: '自身抽 1 張牌，棄置 1 張牌。',
    discardText: '花費[收買2] 抽 2 張牌。',
    *play(g, u) {
      g.draw(u, 1);
      const pick = yield* g.chooseHandCards(u, '武器儲備：選 1 張牌棄置', 1, 1);
      yield* g.discardCards(u, pick);
    },
    *onDiscard(g, u) {
      if (yield* buy(g, u, 2, '武器儲備(棄置時)：抽 2 張牌')) g.draw(u, 2);
    },
  },
  {
    id: 'sav_arms', charId: 'savanna', name: '軍火交易', cost: 1,
    text: '棄置 1 張牌，打擊 1 名單位。',
    discardText: '花費[收買2] 打擊 1 名單位 2 次。',
    *play(g, u) {
      const pick = yield* g.chooseHandCards(u, '軍火交易：選 1 張牌棄置', 1, 1);
      yield* g.discardCards(u, pick);
      const t = yield* g.chooseEnemy(u, '軍火交易：選擇打擊目標');
      if (t) { yield* g.declareAttackTarget(u, t); g.log(`${u.name} 打擊 ${t.name}`, u.owner); g.strikeOnce(u, t); }
    },
    *onDiscard(g, u) {
      if (yield* buy(g, u, 2, '軍火交易(棄置時)：打擊 1 名單位 2 次')) {
        const t = yield* g.chooseEnemy(u, '軍火交易(棄置時)：選擇打擊目標');
        if (t) { yield* g.declareAttackTarget(u, t); g.log(`${u.name} 打擊 ${t.name} 2 次`, u.owner); g.strike(u, t, 2); }
      }
    },
  },
  {
    id: 'sav_contract', charId: 'savanna', name: '武裝合同', cost: 2,
    text: '自身抽 1 張牌。花費[收買2] 選 1 效果：(1) 指定 1 名我方單位恢復 4 HP；(2) 指定 1 名我方單位受到傷害 -1，直到下個自身回合。',
    discardText: '+1 [財富]。',
    *play(g, u) {
      g.draw(u, 1);
      if (yield* buy(g, u, 2, '武裝合同：選 1 個效果')) {
        const opt = yield* g.option(u.owner, '武裝合同：選擇效果', ['指定 1 名我方單位恢復 4 HP', '指定 1 名我方單位受到傷害 -1（直到下個自身回合）']);
        const t = yield* g.chooseAlly(u, opt === 0 ? '選擇要恢復 HP 的我方單位' : '選擇要減傷的我方單位');
        if (!t) return;
        if (opt === 0) g.heal(t, 4);
        else { t.dmgReduce += 1; g.log(`${t.name} 受到的傷害 -1，直到下個自身回合`, u.owner); }
      }
    },
    *onDiscard(g, u) {
      g.addCounter(u, W, 1);
      g.log(`武裝合同(棄置時)：${u.name} +1 財富`, u.owner);
    },
  },
  {
    id: 'sav_norefund', charId: 'savanna', name: '恕不退款', cost: 3,
    text: '指定 1 名我方單位，直到下個自身回合不會陷入[負傷]。花費[收買4] 改為不會減少 TP。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '恕不退款：選擇我方單位');
      if (!t) return;
      if (yield* buy(g, u, 4, '恕不退款：改為不會減少 TP')) {
        t.noTpLoss = true;
        g.log(`${t.name} 直到下個自身回合不會減少 TP`, u.owner);
      } else {
        t.noWound = true;
        g.log(`${t.name} 直到下個自身回合不會陷入[負傷]`, u.owner);
      }
    },
  },
  {
    id: 'sav_vulcan', charId: 'savanna', name: '火神集團', cost: 3,
    text: '最多棄置 2 張牌，每棄 1 張牌回復自身 1 HP。花費[收買4] 打擊 1 名單位 3 次。',
    *play(g, u) {
      const pick = yield* g.chooseHandCards(u, '火神集團：最多棄置 2 張牌（每張回復 1 HP）', 0, 2);
      yield* g.discardCards(u, pick);
      if (pick.length) g.heal(u, pick.length);
      if (yield* buy(g, u, 4, '火神集團：打擊 1 名單位 3 次')) {
        const t = yield* g.chooseEnemy(u, '火神集團：選擇打擊目標');
        if (t) { yield* g.declareAttackTarget(u, t); g.log(`${u.name} 打擊 ${t.name} 3 次`, u.owner); g.strike(u, t, 3); }
      }
    },
  },
  {
    id: 'sav_jackpot', charId: 'savanna', name: '一本萬利', cost: 4,
    text: '棄置所有手牌，隨後隊友抽 2 張牌。',
    discardText: '我方抽 1 張牌（兩隻各抽 1 張）。',
    *play(g, u) {
      yield* g.discardCards(u, u.hand.map(c => c.uid));
      const mate = g.teammate(u);
      if (g.draw(mate, 2, true)) g.log(`${mate.name} 抽 2 張牌`, u.owner);
    },
    *onDiscard(g, u) {
      for (const a of g.state.players[u.owner].units) g.draw(a, 1);
    },
  },
  {
    id: 'sav_heiress', charId: 'savanna', name: '武裝千金', cost: 6,
    text: '我方全體[洗牌]，使敵方全體 -3 TP。花費[收買4] 本回合結束時，敵方的[重創]單位下個回合只能回復 ½ 的 TP（無條件進位）。',
    discardText: '+1 [財富]。',
    *play(g, u) {
      for (const a of g.state.players[u.owner].units) g.abilityShuffle(a);
      for (const e of g.enemiesOf(u.owner)) { g.log(`${e.name} -3 TP`, u.owner); g.loseTp(e, 3); }
      if (yield* buy(g, u, 4, '武裝千金：本回合結束時，敵方[重創]單位下回合只回復一半 TP')) {
        g.state.endOfTurn.push({ kind: 'halfTp', by: u.id });
      }
    },
    *onDiscard(g, u) {
      g.addCounter(u, W, 1);
      g.log(`武裝千金(棄置時)：${u.name} +1 財富`, u.owner);
    },
  },
];

const savanna: CharDef = {
  id: 'savanna',
  name: '薩凡娜',
  title: '棄牌、輔助、小破、補牌',
  theme: '#e0a93e',
  lore: '本為火神家族的旁系血脈，卻因具備強大的經商能力和判斷力，為家族帶來極大的利益，而鞏固了自己的地位。本身並沒有過人的戰鬥能力，但以她的財富和人脈，跟她合作，絕對不會讓你吃虧。',
  hp: 45, ap: 7, tp: 6, at: 1, atkCost: 1, sp: 0,
  counters: [{ id: W, name: '財富' }],
  keywords: {
    財富: '薩凡娜的資源。我方每次棄牌時 +1。用來發動[收買]。',
    收買: '[收買X]：花費 X 層[財富]，發動後面寫的額外效果（可以選擇不發動）。財富不夠就不能發動。',
  },
  abilities: [
    { id: 'p1', active: false, name: '人脈', text: '每回合首次觸發[收買]時，隊友抽 1 張牌。' },
    {
      id: 'a2', active: true, name: '週轉', text: '自身沒有手牌時，花費[收買2] 抽 1 張牌，使 1 名敵方單位 -1 TP。',
      canUse: (g, u) => u.hand.length === 0 && g.counter(u, W) >= 2 && g.targetableEnemies(u.owner).length > 0,
      *use(g, u) {
        yield* buy(g, u, 2, '週轉：抽 1 張牌，使 1 名敵方 -1 TP', false);
        g.draw(u, 1);
        const t = yield* g.chooseEnemy(u, '週轉：選擇 -1 TP 的敵方單位');
        if (t) { g.log(`${t.name} -1 TP`, u.owner); g.loseTp(t, 1); }
      },
    },
    {
      id: 'a3', active: true, name: '調貨', text: '花費[收買4] 從牌堆或棄牌區檢索 1 張【武裝千金】。',
      canUse: (g, u) => g.counter(u, W) >= 4 && [...u.deck, ...u.discard].some(c => c.defId === 'sav_heiress'),
      *use(g, u) {
        yield* buy(g, u, 4, '調貨：檢索 1 張【武裝千金】', false);
        const inDeck = u.deck.some(c => c.defId === 'sav_heiress');
        const inDis = u.discard.some(c => c.defId === 'sav_heiress');
        let from: 'deck' | 'discard' = inDeck ? 'deck' : 'discard';
        if (inDeck && inDis) from = (yield* g.option(u.owner, '調貨：從哪裡檢索【武裝千金】？', ['牌堆', '棄牌區'])) === 0 ? 'deck' : 'discard';
        const pile = from === 'deck' ? u.deck : u.discard;
        const i = pile.findIndex(c => c.defId === 'sav_heiress');
        u.hand.push(pile.splice(i, 1)[0]);
        if (from === 'deck') g.shuffle(u.deck);
        g.log(`${u.name} 從${from === 'deck' ? '牌堆' : '棄牌區'}檢索【武裝千金】`, u.owner);
      },
    },
    { id: 'p4', active: false, name: '生財有道', text: '我方每次棄牌時，+1 [財富]。' },
    { id: 'p5', active: false, name: '補貨', text: '回合開始時，如果沒有手牌，則額外抽 1 張。' },
  ],
  deck: [
    ['sav_stock', 4], ['sav_arms', 3], ['sav_contract', 2], ['sav_norefund', 2],
    ['sav_vulcan', 2], ['sav_jackpot', 2], ['sav_heiress', 2],
  ],
  hooks: {
    onTurnStartBeforeDraw(g, u) {
      if (u.hand.length === 0) {
        g.draw(u, 1, true);
        g.log(`[薩凡娜] 沒有手牌，額外抽 1 張`, u.owner);
      }
    },
    onAllyDiscard(g, u) {
      g.addCounter(u, W, 1);
    },
  },
};

registerChar(savanna, cards);

// 武裝千金 [收買4]：回合結束時，敵方[重創]單位下回合只回復一半 TP
registerEndOfTurn('halfTp', (g, by) => {
  for (const en of g.enemiesOf(by.owner)) {
    if (en.life === 'alive' && en.critical) {
      en.halfTpNext = true;
      g.log(`${en.name} 處於[重創]，下回合只能回復一半 TP`, by.owner);
    }
  }
});
