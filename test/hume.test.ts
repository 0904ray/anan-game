import { describe, it, expect } from 'vitest';
import { type Game } from '../src/engine';
import { newGame, answer, give, type Team } from './helpers';

// =====================================================================
// 休姆：TP 沒有上限、在[瀕死]徘徊、[罪人]／[赦免]、[反擊]（17 張）
// =====================================================================

const HUME: Team = ['hume', 'savanna'];
const FOE: Team = ['savanna', 'savanna'];
const FOE_YAE: Team = ['yae', 'savanna'];

const H = 'p0u0';  // 休姆
const M = 'p0u1';  // 隊友（薩凡娜）
const E = 'p1u0';  // 敵人
const E2 = 'p1u1';

const PARDON = 'pardon';
const SIN = 'sin';

/**
 * 乾淨的測試局面：休姆的手牌、牌組、棄牌區都清空，AP 給足以便一直出牌，
 * 只留 1 個敵人（不用每次選目標），並讓敵人不會掉 TP（避免[負傷]的 +1 影響傷害計算）。
 */
function fresh(seed = 1, foe: Team = FOE): Game {
  const g = newGame(HUME, seed, foe);
  const h = g.unit(H);
  h.hand = [];
  h.deck = [];
  h.discard = [];
  h.ap = 20;
  g.unit(M).hand = [];
  g.unit(E2).life = 'dead';
  const e = g.unit(E);
  e.hp = e.maxHp;
  e.noTpLoss = true;
  return g;
}

const h = (g: Game) => g.unit(H);
const e = (g: Game) => g.unit(E);
const pardon = (g: Game) => g.counter(h(g), PARDON);
const sin = (g: Game, id: string) => g.counter(g.unit(id), SIN);

/** 讓排隊中的延後觸發結算（做一個無關的小動作；不會動到已經有 AP 的單位，例如休姆） */
function flush(g: Game) {
  const p = g.state.active;
  // 優先用在休姆以外的單位，才不會花到休姆的 AP
  const u = g.state.players[p].units.find(x => g.canAct(x) && x.id !== H) ?? g.state.players[p].units.find(x => g.canAct(x))!;
  if (u.ap < 1) u.ap = 5;
  u.advanced = false;
  const r = g.apply(p, { type: 'advance', unitId: u.id });
  expect(r.ok, r.error).toBe(true);
}

/** 把牌組頂（＝下一個抽到的牌）塞進牌組 */
const top = (g: Game, id: string, defId: string) => g.unit(id).deck.push({ uid: 'top' + (++g.state.uidCounter), defId });

describe('休姆：能力', () => {
  it('能力 2：TP 沒有上限，+TP 可以超過 60', () => {
    const g = fresh();
    give(g, H, 'hum_judge');
    const uid = h(g).hand[0].uid;
    const r = g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(r.ok, r.error).toBe(true);
    expect(h(g).tp).toBe(61); // 60 + 1
    answer(g, E); // 判教：指定 1 名單位
  });

  it('能力 2：TP 超過 60 時，回合開始不會被扣回 60', () => {
    const g = fresh();
    h(g).tp = 70;
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' }); // 回到休姆的回合
    expect(h(g).tp).toBe(70);
  });

  it('能力 2：進入[瀕死]的回滿不會把超過 60 的 TP 往下扣', () => {
    const g = fresh();
    h(g).tp = 70;
    h(g).hp = 1;
    g.dealHp(h(g), 1);
    expect(h(g).life).toBe('dying');
    expect(h(g).tp).toBe(70);
  });

  it('能力 1：HP 5 時算[負傷]，受到攻擊 +1', () => {
    const g = fresh();
    h(g).hp = 5;
    expect(g.isWounded(h(g))).toBe(true); // TP 60，不是 TP 造成的[負傷]
    g.strikeOnce(e(g), h(g));
    expect(h(g).hp).toBe(3); // 1 AT + [負傷] 1
  });

  it('能力 1：HP ≤ 5 但 TP > 30 時，回合開始 TP 不回復', () => {
    const g = fresh();
    h(g).hp = 5;
    h(g).tp = 40;
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'endTurn' });
    expect(h(g).hp).toBe(5);
    expect(h(g).tp).toBe(40);
  });

  it('能力 3：TP 大於 10 時無法被[處決]，TP ≤ 10 時可以', () => {
    const g = fresh();
    h(g).tp = 20;
    g.enterDying(h(g));
    g.executeUnit(h(g));
    expect(h(g).life).toBe('dying');

    h(g).tp = 10;
    g.executeUnit(h(g));
    expect(h(g).life).toBe('dead');
  });

  it('能力 4：回合結束時[瀕死]且 TP > 10 → -10 TP、以 10 HP 回歸', () => {
    const g = fresh();
    g.enterDying(h(g));
    flush(g);
    answer(g, M); // 能力 5 的[罪人]
    h(g).tp = 40;
    g.apply(0, { type: 'endTurn' });
    expect(h(g).life).toBe('alive');
    expect(h(g).hp).toBe(10);
    expect(h(g).tp).toBe(30);
  });

  it('能力 4：TP ≤ 10 時不發動', () => {
    const g = fresh();
    g.enterDying(h(g));
    flush(g);
    answer(g, M);
    h(g).tp = 8;
    g.apply(0, { type: 'endTurn' });
    expect(h(g).life).toBe('dying');
    expect(h(g).tp).toBe(8);
  });

  it('能力 5：在對方回合進入[瀕死]也會跳出「給予[罪人]」的選擇，並 +1 [赦免]', () => {
    const g = fresh();
    g.unit(M).life = 'dead'; // 讓敵人只有休姆可以打
    h(g).hp = 1;
    g.apply(0, { type: 'endTurn' }); // 換對手
    g.apply(1, { type: 'attack', unitId: E });
    expect(h(g).life).toBe('dying');
    expect(g.state.prompt?.player).toBe(0); // 休姆的玩家要選
    expect(pardon(g)).toBe(1);
    answer(g, E);
    expect(sin(g, E)).toBe(1);
  });

  it('能力 5：[赦免]已滿 10 層時，多出來的層數改為 +1 TP', () => {
    const g = fresh();
    g.addCounter(h(g), PARDON, 10);
    h(g).tp = 60;
    g.enterDying(h(g));
    flush(g);
    expect(h(g).tp).toBe(61);
    expect(pardon(g)).toBe(10);
    answer(g, M);
  });

  it('能力 6：自身[瀕死]時 +2 AT、SP +1', () => {
    const g = fresh();
    expect(g.effAt(h(g))).toBe(0);
    expect(g.effSp(h(g))).toBe(0);
    g.enterDying(h(g));
    expect(g.effAt(h(g))).toBe(2);
    expect(g.effSp(h(g))).toBe(1); // [不屈]不會讓 SP 變成 -1
    flush(g);
    answer(g, M);
  });
});

describe('休姆：[罪人] 與 [赦免]', () => {
  it('[罪人]：受到攻擊傷害 +1，不可疊加', () => {
    const g = fresh();
    give(g, H, 'hum_judge');
    give(g, H, 'hum_judge');
    const ids = h(g).hand.map(c => c.uid);
    g.apply(0, { type: 'play', unitId: H, cardUid: ids[0] });
    answer(g, E);
    g.apply(0, { type: 'play', unitId: H, cardUid: ids[1] });
    answer(g, E);
    expect(sin(g, E)).toBe(1); // 不可疊加
    g.strikeOnce(h(g), e(g));
    expect(e(g).hp).toBe(e(g).maxHp - 1); // 休姆 AT 0，只有[罪人]的 +1
  });

  it('[罪人]：該單位自己的回合開始時解除', () => {
    const g = fresh();
    g.addCounter(e(g), SIN, 1);
    g.apply(0, { type: 'endTurn' }); // 輪到敵方的回合開始
    expect(sin(g, E)).toBe(0);
  });

  it('[罪人]：只加在攻擊傷害，不加[直傷]', () => {
    const g = fresh();
    g.addCounter(e(g), SIN, 1);
    g.strikeOnce(h(g), e(g), { fixed: true, power: 1 });
    expect(e(g).hp).toBe(e(g).maxHp - 1);
  });

  it('[赦免]：每回合只有第一次受到的傷害會減傷', () => {
    const g = fresh();
    g.addCounter(h(g), PARDON, 4); // 每 2 層 -1 → -2
    g.strikeOnce(e(g), h(g));
    expect(h(g).hp).toBe(10); // 1 - 2 → 0
    g.strikeOnce(e(g), h(g));
    expect(h(g).hp).toBe(9); // 同一回合第二次就沒有減傷
  });

  it('[赦免]：瀕死時改為減少受到攻擊的 TP 減少量', () => {
    const g = fresh();
    g.addCounter(h(g), PARDON, 4);
    g.enterDying(h(g));
    g.strikeOnce(e(g), h(g));
    expect(h(g).tp).toBe(60); // 1 - 2 → 0
    g.strikeOnce(e(g), h(g));
    expect(h(g).tp).toBe(59);
    flush(g);
    answer(g, M);
  });
});

describe('休姆：【反擊】', () => {
  it('敵方普攻指定休姆 → 詢問 → 打出【殉教】：攻擊取消、對方 AP 照付', () => {
    const g = fresh();
    give(g, H, 'hum_martyr');
    g.unit(M).life = 'dead';
    g.apply(0, { type: 'endTurn' });
    const ap = e(g).ap;
    g.apply(1, { type: 'attack', unitId: E });
    expect(g.state.prompt?.player).toBe(0);
    expect(g.state.prompt?.kind).toBe('option');
    answer(g, 1); // 打出[反擊]
    expect(h(g).hp).toBe(0); // 這次攻擊被取消（HP 沒扣，是【殉教】讓自己進入[瀕死]）
    expect(e(g).ap).toBe(ap - 1); // 對方付的 AP 照付
    expect(h(g).life).toBe('dying'); // 【殉教】自身陷入[瀕死]
    expect(pardon(g)).toBe(3); // +2【殉教】，+1 能力 5
    expect(h(g).discard.some(c => c.defId === 'hum_martyr')).toBe(true);
    expect(g.state.prompt?.player).toBe(0); // 能力 5：給誰[罪人]
    answer(g, E);
    expect(sin(g, E)).toBe(1);
  });

  it('打出攻擊牌攻擊休姆被[反擊]取消：牌進棄牌區、AP 照付、傷害不結算', () => {
    const g = fresh(1, FOE_YAE);
    give(g, H, 'hum_martyr');
    const uid = give(g, E, 'yae_blade');
    g.unit(M).life = 'dead';
    g.apply(0, { type: 'endTurn' });
    e(g).ap = 20;
    g.apply(1, { type: 'play', unitId: E, cardUid: uid });
    answer(g, 1);
    expect(h(g).life).toBe('dying'); // HP 沒被扣，0 是【殉教】自己進入[瀕死]
    expect(e(g).ap).toBe(18); // 三合 2 AP 照付
    expect(e(g).discard.some(c => c.defId === 'yae_blade')).toBe(true);
    expect(e(g).hand.some(c => c.uid === uid)).toBe(false);
    answer(g, E); // 能力 5
    // 取消後，下一個操作照常進行
    const r = g.apply(1, { type: 'endTurn' });
    expect(r.ok, r.error).toBe(true);
    expect(g.state.prompt).toBeNull();
  });

  it('選擇不反擊：攻擊照常結算', () => {
    const g = fresh();
    give(g, H, 'hum_martyr');
    g.unit(M).life = 'dead';
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'attack', unitId: E });
    answer(g, 0);
    expect(h(g).hp).toBe(9);
    expect(h(g).hand.some(c => c.defId === 'hum_martyr')).toBe(true);
  });

  it('範圍攻擊（打擊所有敵方單位）不會觸發[反擊]', () => {
    const g = fresh(1, FOE_YAE);
    give(g, H, 'hum_martyr');
    const uid = give(g, E, 'yae_tachi');
    g.apply(0, { type: 'endTurn' });
    e(g).ap = 20;
    g.apply(1, { type: 'play', unitId: E, cardUid: uid });
    expect(g.state.prompt).toBeNull();
    expect(h(g).hp).toBeLessThan(10);
    expect(h(g).hand.some(c => c.defId === 'hum_martyr')).toBe(true);
  });

  it('AP 不夠打不出[反擊]牌時不會詢問', () => {
    const g = fresh();
    give(g, H, 'hum_martyr');
    h(g).ap = 3; // 殉教 4 AP
    g.unit(M).life = 'dead';
    g.apply(0, { type: 'endTurn' });
    g.apply(1, { type: 'attack', unitId: E });
    expect(g.state.prompt).toBeNull();
    expect(h(g).hp).toBe(9);
  });

  it('自己回合不能主動打出[反擊]牌', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_martyr');
    expect(g.checkAction(0, { type: 'play', unitId: H, cardUid: uid })).toBe('[反擊]牌只能在被攻擊時打出');
  });

  it('【殉教】[審判]：自己已[瀕死]時改為給攻擊者[罪人]', () => {
    const g = fresh();
    give(g, H, 'hum_martyr');
    g.unit(M).life = 'dead';
    g.apply(0, { type: 'endTurn' });
    h(g).hp = 2;
    g.dealHp(h(g), 2); // 直接進入[瀕死]，排入能力 5 的延後觸發
    flush(g);
    answer(g, H); // 能力 5 給自己[罪人]
    const tp = h(g).tp;
    g.apply(1, { type: 'attack', unitId: E });
    answer(g, 1);
    expect(sin(g, E)).toBe(1);
    expect(h(g).life).toBe('dying');
    expect(h(g).tp).toBe(tp); // 攻擊被取消，沒有扣 TP
  });
});

describe('休姆：牌', () => {
  it('【判教】：自身 +1 TP 並給[罪人]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_judge');
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    answer(g, E);
    expect(h(g).tp).toBe(61);
    expect(sin(g, E)).toBe(1);
  });

  it('【判教】[審判]：[直擊]用[瀕死]的 AT，可以再花 2 AP 讓目標 -X TP', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_judge');
    e(g).noTpLoss = false;
    g.enterDying(h(g));
    flush(g);
    answer(g, M);
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    answer(g, E); // [直擊]目標
    expect(e(g).hp).toBe(e(g).maxHp - 2); // 0 + 2（[瀕死]）
    answer(g, true); // 額外 2 AP
    expect(e(g).tp).toBe(4); // 6 - 2
    expect(h(g).ap).toBe(17); // 20 - 1 - 2
  });

  it('【無端指控】：本回合 SP -1，回合結束時還原', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_accuse');
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    answer(g, E);
    expect(g.effSp(e(g))).toBe(-1);
    g.apply(0, { type: 'endTurn' });
    expect(g.effSp(e(g))).toBe(0);
  });

  it('【無端指控】[審判]：改為給[罪人]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_accuse');
    g.enterDying(h(g));
    flush(g);
    answer(g, M);
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    answer(g, E);
    expect(sin(g, E)).toBe(1);
    expect(g.effSp(e(g))).toBe(0);
  });

  it('【苦修】：目標以「AT − [赦免]」打擊休姆，然後得到[罪人]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_penance');
    g.addCounter(h(g), PARDON, 0);
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    answer(g, E);
    expect(h(g).hp).toBe(9); // 薩凡娜 AT 1 - 0
    expect(sin(g, E)).toBe(1);
  });

  it('【苦修】[審判]：所有[罪人]單位打擊自身', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_penance');
    g.addCounter(e(g), SIN, 1);
    g.addCounter(g.unit(M), SIN, 1);
    g.enterDying(h(g));
    flush(g);
    answer(g, H);
    const eh = e(g).hp;
    const mh = g.unit(M).hp;
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    // [打擊自身]也是攻擊：會吃到[罪人]的 +1
    expect(e(g).hp).toBe(eh - 2);
    expect(g.unit(M).hp).toBe(mh - 2);
  });

  it('【不滅教義】：+2 TP、抽 2 張牌，每 2 層[赦免]再 +1 TP', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_doctrine');
    g.addCounter(h(g), PARDON, 4);
    h(g).tp = 50;
    top(g, H, 'hum_judge');
    top(g, H, 'hum_judge');
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(h(g).tp).toBe(54); // 50 + 2 + 2
    expect(h(g).hand.length).toBe(2);
  });

  it('【不滅教義】[審判]：-5 TP 後[救治]自身（10 HP），再抽 1 張牌；當回合不能行動', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_doctrine');
    g.enterDying(h(g));
    flush(g);
    answer(g, M);
    h(g).tp = 20;
    top(g, H, 'hum_judge');
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(h(g).life).toBe('alive');
    expect(h(g).hp).toBe(10);
    expect(h(g).tp).toBe(15);
    expect(h(g).ap).toBe(0); // 救治後當回合不能再行動
    expect(h(g).hand.length).toBe(1); // 抽 1 張照樣執行
  });

  it('【不滅教義】[審判]：TP ≤ 5 時不能打出', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_doctrine');
    g.enterDying(h(g));
    flush(g);
    answer(g, M);
    h(g).tp = 5;
    const err = g.checkAction(0, { type: 'play', unitId: H, cardUid: uid });
    expect(err).toContain('處決');
    expect(g.apply(0, { type: 'play', unitId: H, cardUid: uid }).ok).toBe(false);
  });

  it('【洗滌】：所有[罪人]單位 -X TP，然後解除[罪人]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_cleanse');
    g.addCounter(h(g), PARDON, 4);
    g.addCounter(e(g), SIN, 1);
    g.addCounter(g.unit(M), SIN, 1);
    e(g).noTpLoss = false;
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(e(g).tp).toBe(2); // 6 - 4
    expect(g.unit(M).tp).toBe(2);
    expect(sin(g, E)).toBe(0);
    expect(sin(g, M)).toBe(0);
  });

  it('【洗滌】[審判]：休姆以 X 點 AT 打擊所有[罪人]單位，然後 -3 [赦免]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_cleanse');
    g.enterDying(h(g));
    flush(g);
    answer(g, H); // 能力 5（會 +1 [赦免]）
    h(g).counters.pardon = 4;
    g.addCounter(e(g), SIN, 1);
    e(g).noTpLoss = false;
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(e(g).hp).toBe(e(g).maxHp - 5); // 4 點 AT + [罪人] 1
    expect(e(g).tp).toBe(5); // 6 - 1（打擊）
    expect(sin(g, E)).toBe(0);
    expect(pardon(g)).toBe(1); // 4 - 3
  });

  it('【萬物皆有罪】：給自己和 1 名敵人[罪人]，+5 AP 後[洗牌]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_allsin');
    g.apply(0, { type: 'play', unitId: H, cardUid: uid }); // 只剩 1 個敵人，不用選
    expect(sin(g, H)).toBe(1);
    expect(sin(g, E)).toBe(1);
    expect(h(g).ap).toBe(19); // 20 - 6 + 5
  });

  it('【萬物皆有罪】：[赦免] ＝ 10 時費用變 2、效果改為給敵方全體[罪人]', () => {
    const g = fresh();
    const uid = give(g, H, 'hum_allsin');
    g.addCounter(h(g), PARDON, 10);
    g.apply(0, { type: 'play', unitId: H, cardUid: uid });
    expect(h(g).ap).toBe(18); // 20 - 2
    expect(sin(g, H)).toBe(0); // 沒有給自己
    expect(sin(g, E)).toBe(1);
  });
});

describe('正規化：[赦免]的[瀕死]減免只套用在攻擊', () => {
  it('【不滅教義】[審判]的 -5 TP 不會被[赦免]減少，也不會用掉本回合的減免', () => {
    const g = newGame(['hume', 'savanna'], 1);
    const h = g.state.players[0].units[0];
    g.addCounter(h, 'pardon', 4); // 每回合第一次受到攻擊時 TP 減少量 -2
    g.enterDying(h);
    while (g.state.prompt) g.apply(g.state.prompt.player, { type: 'answer', value: g.state.prompt.kind === 'unit' ? (g.state.prompt as any).unitIds[0] : 0 });
    h.tp = 20; h.ap = 7;
    const uid = give(g, h.id, 'hum_doctrine');
    expect(g.apply(0, { type: 'play', unitId: h.id, cardUid: uid }).ok).toBe(true);
    expect(h.tp).toBe(15); // 付了完整的 5 TP
    expect(h.life).toBe('alive');
    expect(g.counter(h, 'pardonCut')).not.toBe(g.state.turn); // 減免還沒用掉
  });
});
