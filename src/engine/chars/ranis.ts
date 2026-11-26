import { registerChar, registerStatus, type CardDef, type CharDef } from '../defs';
import type { Game } from '../game';
import type { Unit } from '../types';

// =====================================================================
// 拉尼斯：洗牌、掃場、全場小破、單體大破（17 張）
// =====================================================================

const AB = 'abyss';      // [墬淵]：永久，最大 TP -1（不可疊加），標記在被指定的單位身上
const SW = 'shuffles';   // 本回合（自己的回合）已觸發幾次「我方洗牌」的掃場
const DE = 'desecrate';  // [瀆神海域]：下一個進入[重創]的單位額外受到 3 [直傷]
const SWEEP_MAX = 3;
const MILL = 8;          // 牌組移除至棄牌區的張數

/** 給目標永久[墬淵]（不可疊加）：最大 TP -1，目前的 TP 也跟著降到新上限 */
function giveAbyss(g: Game, by: Unit, t: Unit) {
  if (t.life === 'dead' || g.counter(t, AB) > 0) return;
  g.addCounter(t, AB, 1);
  t.tpMaxDown += 1;
  t.tp = Math.min(t.tp, g.effTpMax(t));
  g.log(`【${by.name}】${t.name} 被賦予永久[墬淵]（最大 TP -1）`, by.owner);
  g.fx({ t: 'status', unitId: t.id, text: '墬淵' });
}

/** 敵方身上的[墬淵]單位 */
const abyssEnemies = (g: Game, u: Unit) => g.enemiesOf(u.owner).filter(e => g.counter(e, AB) > 0);

/** 牌組最上方 8 張放進棄牌區 */
const mill8 = (g: Game, u: Unit) => g.mill(u, MILL);

/** (抽出時)「如果自身棄牌區 ≤ 1，從牌組移除 8 張牌至棄牌區」 */
const DRAW_MILL = '如果自身棄牌區 ≤ 1，從牌組[移除] 8 張牌至棄牌區。';
function millIfDiscardEmpty(g: Game, u: Unit) {
  if (u.discard.length <= 1) mill8(g, u);
}

const cards: CardDef[] = [
  {
    id: 'ran_fish', charId: 'ranis', name: '暴躁魚群', cost: 2,
    text: '自身抽 1 張牌，對敵方全體造成 1 點[直擊]，再指定 1 名敵方單位受到 2 點[直傷]。從牌組[移除] 8 張牌至棄牌區。',
    *play(g, u) {
      g.draw(u, 1);
      for (const e of g.enemiesOf(u.owner)) g.strikeOnce(u, e, { direct: true, power: 1 });
      const t = yield* g.chooseEnemy(u, '暴躁魚群：指定 1 名敵方單位受到 2 [直傷]');
      if (t) {
        g.log(`${t.name} 受到 2 點[直傷]`, u.owner);
        g.dealHp(t, 2);
      }
      mill8(g, u);
    },
  },
  {
    id: 'ran_tide', charId: 'ranis', name: '海潮暗湧', cost: 2,
    text: '自身抽 1 張牌，使敵方全體 -1 TP，再指定 1 名敵方單位 -1 TP。從牌組[移除] 8 張牌至棄牌區。',
    *play(g, u) {
      g.draw(u, 1);
      for (const e of g.enemiesOf(u.owner)) { g.log(`${e.name} -1 TP`, u.owner); g.loseTp(e, 1); }
      const t = yield* g.chooseEnemy(u, '海潮暗湧：指定 1 名敵方單位再 -1 TP');
      if (t) { g.log(`${t.name} -1 TP`, u.owner); g.loseTp(t, 1); }
      mill8(g, u);
    },
  },
  {
    id: 'ran_whisper', charId: 'ranis', name: '海妖低語', cost: 2,
    text: '自身抽 2 張牌，之後從牌組[移除] 8 張牌至棄牌區。',
    *play(g, u) {
      g.draw(u, 2);
      mill8(g, u);
    },
  },
  {
    id: 'ran_sea', charId: 'ranis', name: '瀆神海域', cost: 4,
    text: '下一個陷入[重創]的單位（敵我皆算）額外受到 3 點[直傷]。如果敵方的[墬淵]單位 ≥ 2，自身[洗牌]。',
    *play(g, u) {
      g.addCounter(u, DE, 1);
      g.log('[瀆神海域] 任一單位陷入[重創]時額外受到 3 點[直傷]', u.owner);
      if (abyssEnemies(g, u).length >= 2) {
        g.log('敵方[墬淵]單位 ≥ 2，[瀆神海域]讓拉尼斯[洗牌]', u.owner);
        g.abilityShuffle(u);
      }
    },
  },
  {
    id: 'ran_vortex', charId: 'ranis', name: '黑漩', cost: 6,
    text: '對 1 名敵方單位造成 5 點[直傷]，自身[洗牌]。',
    drawText: DRAW_MILL,
    onDrawCard: millIfDiscardEmpty,
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '黑漩：指定 1 名敵方單位受到 5 [直傷]');
      if (t) {
        g.log(`${t.name} 受到 5 點[直傷]`, u.owner);
        g.dealHp(t, 5);
      }
      g.abilityShuffle(u);
    },
  },
  {
    id: 'ran_anchor', charId: 'ranis', name: '海縛巨錨', cost: 8,
    text: '使 1 名敵方單位 -7 TP，並受到 2 點[直傷]。',
    drawText: DRAW_MILL,
    onDrawCard: millIfDiscardEmpty,
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '海縛巨錨：指定 1 名敵方單位');
      if (!t) return;
      g.log(`${t.name} -7 TP`, u.owner);
      g.loseTp(t, 7);
      g.log(`${t.name} 受到 2 點[直傷]`, u.owner);
      g.dealHp(t, 2);
    },
  },
  {
    id: 'ran_fork', charId: 'ranis', name: '血叉', cost: 8,
    text: '[打擊] 1 名敵方單位。如果該單位上回合處於[重創]，再[打擊] 1 次。',
    drawText: DRAW_MILL,
    onDrawCard: millIfDiscardEmpty,
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '血叉：指定 1 名敵方單位');
      if (!t) return;
      g.log(`${u.name} 血叉：打擊 ${t.name}`, u.owner);
      g.strikeOnce(u, t);
      if (t.life !== 'dead' && t.criticalPrev) {
        g.log(`${t.name} 上回合處於[重創]，血叉再觸發 1 次`, u.owner);
        g.strikeOnce(u, t);
      }
    },
  },
  {
    id: 'ran_maw', charId: 'ranis', name: '深淵巨口', cost: 8, removeAfterPlay: true,
    text: '指定 1 名敵方單位，受到其已損失 HP 一半的[直傷]（無條件進位）。如果該單位使用時已是[瀕死]單位，[處決]該單位，之後回復自身 10 HP。使用後[移出牌局]。',
    drawText: DRAW_MILL,
    onDrawCard: millIfDiscardEmpty,
    *play(g, u) {
      const t = yield* g.chooseEnemy(u, '深淵巨口：指定 1 名敵方單位');
      if (!t) return;
      const wasDying = t.life === 'dying'; // 「指定的單位是[瀕死]單位」＝使用時就已經[瀕死]
      const lost = Math.max(0, t.maxHp - t.hp);
      const dmg = Math.ceil(lost / 2);
      g.log(`深淵巨口：${t.name} 已損失 ${lost} HP，受到 ${dmg} 點[直傷]`, u.owner);
      g.dealHp(t, dmg);
      if (wasDying && t.life === 'dying') {
        g.log(`深淵巨口：[處決] ${t.name}`, u.owner);
        g.executeUnit(t);
        g.heal(u, 10);
      }
    },
  },
];

const ranis: CharDef = {
  id: 'ranis',
  name: '拉尼斯',
  title: '洗牌、掃場、全場小破、單體大破',
  theme: '#2f8f9a',
  lore: '深海中極為強大的存在，人類因恐懼將其封印在深淵中，但這並不影響她對這片海域的掌控。雖然被封印著，她仍能利用自身創造的海域，讓對手慢慢地墬入深淵，直到在一片漆黑中看見一對不祥的雙眼。',
  hp: 45, ap: 8, tp: 8, at: 8, atkCost: 8, sp: 0,
  counters: [
    { id: SW, name: '掃場' },
    { id: DE, name: '瀆神海域', hidden: true }, // 生效中會在拉尼斯身上顯示[瀆神海域]徽章
  ],
  keywords: {
    墬淵: '永久狀態，不可疊加：該單位的最大 TP -1（目前的 TP 也會一起降下來）。拉尼斯只能指定[墬淵]單位，而且不受 SP 限制。',
    瀆神海域: '拉尼斯打出【瀆神海域】後的狀態：下一個陷入[重創]的單位（敵我皆算）額外受到 3 點[直傷]，結算一次就結束。',
  },
  abilities: [
    { id: 'p1', active: false, name: '深淵之主', text: '我方每次[洗牌]時，拉尼斯對敵方全體造成 AT 1 的[打擊]（每回合最多 3 次）。' },
    { id: 'p2', active: false, name: '墬淵之眼', text: '拉尼斯只能指定[墬淵]單位，且不受 SP 限制（特殊狀況除外）。' },
    { id: 'p3', active: false, name: '沉入深淵', text: '敵方單位陷入[重創]時，給予該單位永久[墬淵]。' },
    { id: 'p4', active: false, name: '漆黑的雙眼', text: '回合結束時，可選至多 3 張手牌[移除]至棄牌區，之後從牌組[移除]同樣數量的牌至棄牌區。' },
  ],
  deck: [
    ['ran_fish', 4], ['ran_tide', 4], ['ran_whisper', 2], ['ran_sea', 2],
    ['ran_vortex', 2], ['ran_anchor', 1], ['ran_fork', 1], ['ran_maw', 1],
  ],
  hooks: {
    /** 每回合的掃場次數在自己的回合開始時歸零 */
    onTurnStartBeforeDraw(g, u) {
      const n = g.counter(u, SW);
      if (n) g.addCounter(u, SW, -n);
    },
    /** 能力 2：只能指定[墬淵]單位，而且不受 SP 限制 */
    enemyTargets(g, u) {
      return abyssEnemies(g, u);
    },
    /** 能力 1：我方每次[洗牌]，對敵方全體造成 AT 1 的[打擊]（每回合最多 3 次） */
    onAllyShuffle(g, u) {
      if (u.life !== 'alive') return;
      if (g.counter(u, SW) >= SWEEP_MAX) {
        g.log(`[拉尼斯] 本回合的洗牌掃場已達 ${SWEEP_MAX} 次`, u.owner);
        return;
      }
      g.addCounter(u, SW, 1);
      g.log(`[拉尼斯] 我方[洗牌]：對敵方全體造成 AT 1 的[打擊]（本回合第 ${g.counter(u, SW)} 次）`, u.owner);
      for (const e of g.enemiesOf(u.owner)) g.strikeOnce(u, e, { power: 1 });
    },
    /** 能力 3（敵方進入[重創]→[墬淵]）與瀆神海域的額外直傷 */
    onUnitCritical(g, u, t) {
      if (u.life !== 'alive') return;
      if (t.owner !== u.owner) giveAbyss(g, u, t);
      if (g.counter(u, DE) > 0) {
        g.addCounter(u, DE, -g.counter(u, DE));
        g.log(`【瀆神海域】${t.name} 陷入[重創]，額外受到 3 點[直傷]`, u.owner);
        g.fx({ t: 'status', unitId: t.id, text: '瀆神海域' });
        g.dealHp(t, 3);
      }
    },
    /** 能力 4：回合結束時，可選至多 3 張手牌[移除]至棄牌區，之後從牌組[移除]同樣數量的牌至棄牌區（都不算棄牌） */
    *onOwnTurnEnd(g, u) {
      if (u.life !== 'alive') return;
      const pick = yield* g.chooseHandCards(u, `${u.name} 回合結束：選至多 3 張手牌[移除]至棄牌區（之後從牌組移除同樣數量的牌至棄牌區；可以不選）`, 0, 3);
      if (!pick.length) return;
      const n = g.millHand(u, pick);
      g.mill(u, n);
    },
  },
};

registerStatus({ id: AB, name: '墬淵' });
registerStatus({ id: DE, name: '瀆神海域' });
registerChar(ranis, cards);
