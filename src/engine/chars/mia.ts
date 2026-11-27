import { registerChar, registerStatus, type CardDef, type CharDef, type Eff } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 米雅：奶媽、多次救治、沒傷害（17 張）
// =====================================================================

const HOLY = 'holy';      // [聖環]：自己的回合結束與受到治療時回復 1 HP（自己回合開始時解除）
const HOLYP = 'holyP';    // 永久[聖環]：不解除
const HD = 'healDraw';    // 本回合「我方首次回復 HP」是否已經抽過牌
const ATD = 'atDown';     // 【告罪】扣掉的 AT（記在目標身上，目標的回合結束時加回去＝米雅的下個回合開始前）
const FAVOR = 'favor';    // 【不公之恩寵】使用過的次數（使用 2 次後移出牌局）

const hasHoly = (g: Game, u: Unit) => g.counter(u, HOLY) > 0 || g.counter(u, HOLYP) > 0;
const hasPermHoly = (g: Game, u: Unit) => g.counter(u, HOLYP) > 0;

/** 給單位[聖環]（同一名單位只能有一個，不可疊加） */
function giveHoly(g: Game, by: Unit, t: Unit, permanent = false) {
  if (hasPermHoly(g, t)) return false;
  if (permanent) {
    g.addCounter(t, HOLY, -g.counter(t, HOLY)); // 臨時的升級成永久的
    g.addCounter(t, HOLYP, 1);
  } else {
    if (hasHoly(g, t)) return false;
    g.addCounter(t, HOLY, 1);
  }
  g.log(`【${by.name}】${t.name} 獲得${permanent ? '永久' : ''}[聖環]`, by.owner);
  g.fx({ t: 'status', unitId: t.id, text: '聖環' });
  return true;
}

const cards: CardDef[] = [
  {
    id: 'mia_sigh', charId: 'mia', name: '聖雅嘆息', cost: 1,
    text: '回復我方 1 名單位 1 HP。如果該單位上回合處於[負傷]，改為 2 HP。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '聖雅嘆息：選 1 名要回復的我方單位');
      if (!t) return;
      g.heal(t, t.woundedPrev ? 2 : 1);
    },
  },
  {
    id: 'mia_prayer', charId: 'mia', name: '渙散祈禱', cost: 2,
    text: '回復我方全體 1 HP；[聖環]單位再回復 2 HP、抽 1 張牌。',
    *play(g, u) {
      for (const a of g.allies(u)) {
        const holy = hasHoly(g, a);
        g.heal(a, holy ? 3 : 1); // 同一張牌對同一個單位算一次治療（[聖環]的治療加成只加一次）
        if (holy) g.draw(a, 1);
      }
    },
  },
  {
    id: 'mia_trouble', charId: 'mia', name: '麻煩死了', cost: 2,
    text: '給予我方 1 名單位 +1 [臨時TP]。如果該單位有[聖環]，改為 +3 [臨時TP]。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '麻煩死了：選 1 名要給予臨時 TP 的我方單位');
      if (!t) return;
      const n = hasHoly(g, t) ? 3 : 1;
      t.tTp += n;
      g.log(`${t.name} 獲得臨時 ${n} TP`, u.owner);
      g.fx({ t: 'status', unitId: t.id, text: `臨時TP+${n}` });
    },
  },
  {
    id: 'mia_grace', charId: 'mia', name: '恩典', cost: 3,
    text: '回復我方 1 名單位 3 HP，該單位抽 1 張牌。如果該單位有[聖環]，改為 5 HP、該單位抽 2 張牌。',
    *play(g, u) {
      const t = yield* g.chooseAlly(u, '恩典：選 1 名要回復的我方單位');
      if (!t) return;
      const holy = hasHoly(g, t);
      g.heal(t, holy ? 5 : 3);
      g.draw(t, holy ? 2 : 1);
    },
  },
  {
    id: 'mia_confess', charId: 'mia', name: '告罪', cost: 4,
    text: '指定 1 名敵方單位 -2 AT，直到米雅的下個回合。',
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '告罪：指定 1 名敵方單位 -2 AT');
      if (!t) return;
      const cut = Math.min(2, Math.max(0, t.at)); // AT 不會被扣到負的，實際扣多少就記多少
      t.at -= cut;
      g.addCounter(t, ATD, cut);
      g.log(`${t.name} -${cut} AT，直到米雅的下個回合`, u.owner);
      g.fx({ t: 'status', unitId: t.id, text: `AT-${cut}` });
    },
  },
  {
    id: 'mia_bored', charId: 'mia', name: '沒興趣', cost: 5,
    text: '我方全體單位受到傷害 -1，直到下個自身回合；[聖環]單位改為 -2。',
    *play(g, u) {
      for (const a of g.allies(u)) {
        const n = hasHoly(g, a) ? 2 : 1;
        a.dmgReduce += n;
        g.log(`${a.name} 受到的傷害 -${n}，直到我方下個回合開始`, u.owner);
      }
    },
  },
  {
    id: 'mia_favor', charId: 'mia', name: '不公之恩寵', cost: 7,
    text: '選 1 項：(1) 指定 1 名我方單位給予永久[聖環]、永久 +1 TP；(2) 無條件[救治] 1 名[瀕死]單位，再回復該單位 5 HP；(3) 回復我方全體 10 HP。使用 2 次後[移出牌局]。',
    removeAfterPlay: (g, u) => g.counter(u, FAVOR) >= 2,
    *play(g, u): Eff {
      g.addCounter(u, FAVOR, 1);
      const dying = g.state.players[u.owner].units.filter(x => x.life === 'dying');
      const opts = ['指定 1 名我方單位：永久[聖環]、永久 +1 TP'];
      if (dying.length) opts.push('無條件[救治] 1 名[瀕死]單位，再回復該單位 5 HP');
      opts.push('回復我方全體 10 HP');
      const pick = yield* g.option(u.owner, '不公之恩寵：選 1 項', opts);

      if (pick === 0) {
        const t = yield* g.chooseUnit(u.owner, '不公之恩寵：選 1 名我方單位', g.state.players[u.owner].units.filter(x => x.life === 'alive'));
        if (!t) return;
        giveHoly(g, u, t, true);
        t.tpMax += 1;
        t.tp += 1;
        g.log(`${t.name} 最大 TP +1（${t.tpMax}）`, u.owner);
      } else if (dying.length && pick === 1) {
        const t = yield* g.chooseUnit(u.owner, '不公之恩寵：選 1 名[瀕死]的我方單位', dying);
        if (!t) return;
        g.log(`【${u.name}】無條件[救治] ${t.name}`, u.owner);
        g.reviveUnit(t, t.tp * 2); // 和一般[救治]一樣以「TP × 2」的 HP 回歸，只是不用付代價
        g.heal(t, 5);
      } else {
        for (const a of g.allies(u)) g.heal(a, 10);
      }
    },
  },
];

const mia: CharDef = {
  id: 'mia',
  name: '米雅',
  title: '奶媽、多次救治、沒傷害',
  theme: '#d6c88f',
  lore: '從小雙親被盜賊殺害，被教團收養；隨著年齡增長，她發現雇用那些盜賊的就是教團——因為他們的神愛上了米雅，教團便不擇手段讓她入教。即使知道了真相，她也無法反抗教團，只能接受神明的恩寵。不具備戰鬥能力，而且十分怠惰，但在神明的恩寵下，祂不會讓敵人以外的屍體出現在她眼前。',
  hp: 40, ap: 7, tp: 4, at: 0, atkCost: 1, sp: 0,
  rescueUnlimited: true,
  counters: [
    { id: FAVOR, name: '恩寵', hidden: true },
    { id: HD, name: '本回合已抽', hidden: true },
  ],
  keywords: {
    聖環: '擁有[聖環]的單位，自己的回合結束時與受到治療時各自回復 1 HP；擁有者自己的下一個回合開始時解除（永久[聖環]不會解除）。同一名單位只能有一個[聖環]，不會疊加。',
    告罪: '【告罪】造成的 AT 減少：目標自己的回合結束時恢復（也就是撐到米雅的下個回合）。',
  },
  abilities: [
    { id: 'p1', active: false, name: '神的恩寵', text: '米雅[救治]友軍不限次數，而且不佔用一局一次的額度。' },
    {
      id: 'a2', active: true, name: '聖旨', text: '花費 2 AP：給予我方 1 名單位[聖環]。',
      canUse: (g, u) => u.ap >= 2 && g.state.players[u.owner].units.some(x => x.life === 'alive' && !hasHoly(g, x)),
      *use(g, u) {
        const targets = g.state.players[u.owner].units.filter(x => x.life === 'alive' && !hasHoly(g, x));
        const t = yield* g.chooseUnit(u.owner, '聖旨：選 1 名我方單位給予[聖環]', targets);
        if (!t) return;
        u.ap -= 2;
        giveHoly(g, u, t);
      },
    },
    { id: 'p3', active: false, name: '恩典的餘光', text: '每回合我方單位首次回復 HP 時，米雅抽 1 張牌。' },
    { id: 'p4', active: false, name: '怠惰的天使', text: '隊友擁有[聖環]時，米雅的 SP -1。' },
  ],
  deck: [
    ['mia_sigh', 4], ['mia_prayer', 3], ['mia_trouble', 2], ['mia_grace', 3],
    ['mia_confess', 2], ['mia_bored', 2], ['mia_favor', 1],
  ],
  hooks: {
    /** 能力 3：每回合我方單位首次實際回復 HP 時抽 1 張 */
    onAllyHeal(g, u) {
      if (u.life !== 'alive' || g.counter(u, HD) > 0) return;
      g.addCounter(u, HD, 1);
      g.draw(u, 1);
      g.log(`[米雅] 我方單位首次回復 HP，抽 1 張牌`, u.owner);
    },
    onTurnStartBeforeDraw(g, u) {
      if (g.counter(u, HD)) g.addCounter(u, HD, -g.counter(u, HD));
    },
    /** 能力 4：隊友擁有[聖環]時 SP -1 */
    spDelta(g, u) {
      const mate = g.teammate(u);
      return mate.life !== 'dead' && hasHoly(g, mate) ? -1 : 0;
    },
  },
};

registerStatus({
  id: HOLY, name: '聖環',
  healBonus: () => 1, // 受到治療時額外回復 1 HP
  onTurnEnd: (g, u) => g.heal(u, 1, true), // 自己回合結束時回復 1 HP（不再套用聖環自己的加成）
  onTurnStart: (g, u) => g.addCounter(u, HOLY, -g.counter(u, HOLY)), // 自己回合開始時解除
});
registerStatus({
  id: HOLYP, name: '聖環',
  healBonus: () => 1,
  onTurnEnd: (g, u) => g.heal(u, 1, true), // 永久[聖環]：不解除
});

// 【告罪】：記在目標身上（畫面顯示徽章），目標自己的回合結束時把 AT 加回去
// ＝「直到米雅的下個回合」；米雅中途陣亡也照樣恢復
registerStatus({
  id: ATD, name: '告罪',
  onTurnEnd: (g, u) => {
    const n = g.counter(u, ATD);
    g.addCounter(u, ATD, -n);
    u.at += n;
    g.log(`${u.name} 的 AT 恢復 +${n}（告罪結束）`, u.owner);
    g.fx({ t: 'status', unitId: u.id, text: `AT+${n}` });
  },
});

registerChar(mia, cards);
