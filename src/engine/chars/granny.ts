import { registerChar, CARD_DEFS, type CardDef, type CharDef, type Eff } from '../defs';
import type { Game } from '../game';
import type { CardInst, Unit } from '../types';

// =====================================================================
// 暴食・葛蘭妮：棄牌、吞牌、後期爆發（17 張）
// =====================================================================

const G = 'gluttony'; // [暴食]
const PERM = 'permAt'; // 能力 5 累積的永久 AT

/** 吞噬：把牌壓到葛蘭妮下方，回復 1 HP（能力 3） */
function devour(g: Game, gran: Unit, card: CardInst, from: Unit, src: 'hand' | 'discard') {
  gran.under.push(card);
  g.log(`${gran.name} 吞噬了【${CARD_DEFS[card.defId].name}】（吞噬 ${gran.under.length} 張，AT ${g.effAt(gran)}）`, gran.owner);
  g.fx({ t: 'devour', unitId: gran.id, fromId: from.id, uid: card.uid, defId: card.defId, src });
  g.heal(gran, 1);
}

/** 我方有手牌的角色（吞噬來源） */
const handOwners = (g: Game, u: Unit) => g.state.players[u.owner].units.filter(x => x.life !== 'dead' && x.hand.length > 0);

/** 從我方任一角色的手牌選 1 張吞噬：兩邊的手牌一起高亮，直接選 */
function* devourFromHand(g: Game, u: Unit, title: string): Eff<boolean> {
  const pick = yield* g.chooseCardsFrom(handOwners(g, u), `${title}：選我方任一角色的 1 張手牌`, 1, 1);
  if (!pick.length) return false;
  const from = g.cardOwner(pick[0]);
  if (!from) return false;
  const i = from.hand.findIndex(c => c.uid === pick[0]);
  devour(g, u, from.hand.splice(i, 1)[0], from, 'hand');
  return true;
}

function spend(g: Game, u: Unit, n: number) { g.addCounter(u, G, -n); }
function gain(g: Game, u: Unit, n: number) {
  g.addCounter(u, G, n);
  g.log(`${u.name} +${n} 暴食（${g.counter(u, G)}）`, u.owner);
}

/** 吞噬牌 ≥ 4 張時減費 */
const discount = (base: number, off: number) => (_g: Game, u: Unit) => (u.under.length >= 4 ? base - off : base);

const cards: CardDef[] = [
  {
    id: 'gra_blood', charId: 'granny', name: '暴食血統', cost: 1,
    text: '+1 [暴食]，棄置 1 張牌。',
    *play(g, u) {
      gain(g, u, 1);
      const pick = yield* g.chooseHandCards(u, '暴食血統：選 1 張牌棄置', 1, 1);
      yield* g.discardCards(u, pick);
    },
  },
  {
    id: 'gra_forage', charId: 'granny', name: '覓食', cost: 2,
    text: '自身抽 2 張牌，+1 [暴食]。如果本回合已棄過牌，自身可再棄 1 張牌。',
    *play(g, u) {
      g.draw(u, 2);
      gain(g, u, 1);
      if (g.state.players[u.owner].discardsThisTurn > 0) {
        const pick = yield* g.chooseHandCards(u, '覓食：本回合已棄過牌，可再棄 1 張（也可以不棄）', 0, 1);
        yield* g.discardCards(u, pick);
      }
    },
  },
  {
    id: 'gra_meal', charId: 'granny', name: '盤中餐', cost: 3,
    text: '花費 1 [暴食] 吞噬我方 1 張手牌，抽 1 張牌。',
    *play(g, u) {
      if (g.counter(u, G) >= 1 && handOwners(g, u).length > 0) {
        spend(g, u, 1);
        yield* devourFromHand(g, u, '盤中餐');
      } else g.log(`${u.name} 沒有暴食或手牌，無法吞噬`, u.owner);
      g.draw(u, 1);
    },
  },
  {
    id: 'gra_drink', charId: 'granny', name: '飲血', cost: 5, costFor: discount(5, 3),
    text: '（吞噬的牌 ≥ 4 張時 -3 AP）打擊 1 名敵方單位，回復與造成傷害相同的 HP。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '飲血：選擇打擊目標');
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      g.log(`${u.name} 打擊 ${t.name}`, u.owner);
      const dmg = g.strikeOnce(u, t);
      if (dmg > 0) g.heal(u, dmg);
    },
  },
  {
    id: 'gra_meat', charId: 'granny', name: '食肉', cost: 5, costFor: discount(5, 3),
    text: '（吞噬的牌 ≥ 4 張時 -3 AP）打擊 1 名敵方單位，之後選擇：吞噬我方 1 張手牌，或 +3 [暴食]。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '食肉：選擇打擊目標');
      if (t) { yield* g.declareAttackTarget(u, t); g.log(`${u.name} 打擊 ${t.name}`, u.owner); g.strikeOnce(u, t); }
      if (u.life !== 'alive') return;
      const opts = ['+3 暴食'];
      if (handOwners(g, u).length) opts.unshift('吞噬我方 1 張手牌');
      const o = opts.length > 1 ? yield* g.option(u.owner, '食肉：選擇效果', opts) : 0;
      if (opts[o] === '+3 暴食') gain(g, u, 3);
      else yield* devourFromHand(g, u, '食肉');
    },
  },
  {
    id: 'gra_bone', charId: 'granny', name: '噬骨', cost: 7, costFor: discount(7, 4),
    text: '（吞噬的牌 ≥ 4 張時 -4 AP）指定 1 名敵方單位：打擊 1 次，再使其 -1 TP；之後可再花 3 [暴食] 重複。指定單位[瀕死]時，可花 6 [暴食] [處決]它，並回復自身 7 HP。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '噬骨：指定 1 名敵方單位');
      if (!t) return;
      yield* g.declareAttackTarget(u, t);
      let first = true;
      while (t.life !== 'dead' && g.state.winner === null && u.life === 'alive') {
        if (t.life === 'dying' && g.counter(u, G) >= 6) {
          const ok = yield* g.confirm(u.owner, `噬骨：${t.name} 已瀕死，花 6 暴食[處決]它並回復 7 HP？（暴食 ${g.counter(u, G)}）`, '處決（-6 暴食）', '不要');
          if (ok) {
            spend(g, u, 6);
            g.log(`${u.name} 噬骨[處決] ${t.name}！`, u.owner);
            g.executeUnit(t);
            g.heal(u, 7);
            break;
          }
        }
        if (!first) {
          if (g.counter(u, G) < 3) break;
          const again = yield* g.confirm(u.owner, `噬骨：花 3 暴食再咬一次 ${t.name}？（暴食 ${g.counter(u, G)}）`, '再咬一次（-3 暴食）', '停手');
          if (!again) break;
          spend(g, u, 3);
        }
        first = false;
        g.log(`${u.name} 噬骨：打擊 ${t.name}，並 -1 TP`, u.owner);
        g.strikeOnce(u, t);
        if ((t.life as string) !== 'dead') g.loseTp(t, 1);
      }
    },
  },
];

const granny: CharDef = {
  id: 'granny',
  name: '葛蘭妮',
  title: '棄牌、吞牌、後期爆發',
  theme: '#a66be0',
  lore: '古老魔族的後裔，本性不壞，但無法抗拒本能的吞噬周邊的事物。時常處於飢餓，但進食後帶來的不是飽足感，而是更加旺盛的食慾，和更為兇殘的力量。',
  hp: 45, ap: 6, tp: 5, at: 1, atkCost: 2, sp: 0,
  counters: [{ id: G, name: '暴食' }, { id: PERM, name: '永久AT', hidden: true }],
  keywords: {
    暴食: '葛蘭妮的資源。我方棄牌時可以選擇 +1，部分卡牌、使用吞噬的牌也會增加；用來[吞噬]和發動卡牌的追加效果。',
    吞噬: '把牌放到葛蘭妮下方的「吞噬」牌堆。每有 X 張，葛蘭妮 AT +X；吞噬的牌可以直接使用，或用「消化」一次放進棄牌區換永久 AT。',
  },
  canPlayUnder: true,
  underName: '吞噬',
  abilities: [
    { id: 'p1', active: false, name: '暴食本能', text: '我方每次棄牌時，選 1 效果：(1) +1 [暴食]；(2) 花費 3 [暴食]，把棄置的牌吞噬到葛蘭妮下方，並抽 1 張牌。' },
    { id: 'p2', active: false, name: '吞噬之力', text: '葛蘭妮每持有 X 張吞噬的牌，AT +X。' },
    { id: 'p3', active: false, name: '血肉滋養', text: '葛蘭妮每次打擊、吞噬卡牌時，回復 1 HP。' },
    { id: 'p4', active: false, name: '反芻', text: '葛蘭妮可以使用已吞噬的牌（點「吞噬」牌堆），使用後放入棄牌區，+1 [暴食]。' },
    {
      id: 'a5', active: true, name: '消化', text: '消耗 1 [暴食]，把所有吞噬的牌放入棄牌區；每放入 X 張，AT 永久 +X，並回復 X HP。',
      canUse: (g, u) => g.counter(u, G) >= 1 && u.under.length > 0,
      *use(g, u) {
        spend(g, u, 1);
        const x = u.under.length;
        u.discard.push(...u.under);
        u.under = [];
        g.fx({ t: 'toDiscard', unitId: u.id, n: x });
        g.addCounter(u, PERM, x);
        g.log(`${u.name} 消化了 ${x} 張牌：AT 永久 +${x}（目前 AT ${g.effAt(u)}）`, u.owner);
        g.fx({ t: 'status', unitId: u.id, text: `AT 永久 +${x}` });
        g.heal(u, x);
      },
    },
  ],
  deck: [['gra_blood', 4], ['gra_forage', 4], ['gra_meal', 2], ['gra_drink', 3], ['gra_meat', 3], ['gra_bone', 1]],
  hooks: {
    *onAllyDiscard(g, u, _discarder, card) {
      const canDevour = g.counter(u, G) >= 3 && u.life !== 'dead';
      let o = 0;
      if (canDevour) {
        o = yield* g.option(u.owner, `【${u.name}・暴食本能】我方棄置了【${CARD_DEFS[card.defId].name}】，選擇效果（暴食 ${g.counter(u, G)}）`,
          ['+1 暴食', `花 3 暴食吞噬【${CARD_DEFS[card.defId].name}】並抽 1 張牌`]);
      }
      if (o === 0) { gain(g, u, 1); return; }
      // 把剛棄置的牌從棄牌區拿出來吞掉
      for (const owner of g.state.players[u.owner].units) {
        const i = owner.discard.findIndex(c => c.uid === card.uid);
        if (i >= 0) {
          spend(g, u, 3);
          devour(g, u, owner.discard.splice(i, 1)[0], owner, 'discard');
          g.draw(u, 1);
          return;
        }
      }
      gain(g, u, 1); // 牌已經不在棄牌區（例如被其他效果移走），改拿暴食
    },
    atBonus: (g, u) => u.under.length + g.counter(u, PERM),
    onStrike(g, u) { if (u.life === 'alive') g.heal(u, 1); },
    afterPlayUnder(g, u) { gain(g, u, 1); },
  },
};

registerChar(granny, cards);
