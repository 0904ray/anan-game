import type {
  Action, Answer, CardInst, GameState, PlayerIdx, PlayerState, Prompt, Unit, FxBody, UnitSnap,
} from './types';
import { CARD_DEFS, CHAR_DEFS, END_OF_TURN, STATUS_DEFS, type Eff } from './defs';

export interface ApplyResult { ok: boolean; error?: string }

export class Game {
  state: GameState;
  private gen: Eff<any> | null = null;

  constructor(state: GameState) {
    this.state = state;
  }

  // ======================================================================
  // 建立新對局
  // ======================================================================
  /** 種子由呼叫端給（引擎本身不碰 Math.random），同一個種子＝同一局 */
  static create(opts: { seed: number; names: [string, string]; chars: [[string, string], [string, string]]; first?: PlayerIdx }): Game {
    const seed = opts.seed;
    const state: GameState = {
      seed, turn: 0, active: 0, first: 0,
      players: [null as any, null as any],
      prompt: null, winner: null, log: [], fx: [], fxSeq: 0, endOfTurn: [], uidCounter: 0, gameId: 'g' + seed.toString(36),
    };
    const g = new Game(state);
    for (const p of [0, 1] as PlayerIdx[]) {
      const units = opts.chars[p].map((cid, slot) => g.makeUnit(cid, p, slot as 0 | 1)) as [Unit, Unit];
      if (units[0].charId === units[1].charId) { units[0].name += 'A'; units[1].name += 'B'; } // 同角色時加上 A/B 好分辨
      const ps: PlayerState = { idx: p, name: opts.names[p], units, turnCount: 0, rescueUsed: false, discardsThisTurn: 0 };
      state.players[p] = ps;
    }
    const first: PlayerIdx = opts.first ?? (g.rand() < 0.5 ? 0 : 1);
    state.first = first;
    g.log(`遊戲開始！${state.players[first].name} 先攻。`);
    g.run(g.setupGen(first));
    return g;
  }

  private makeUnit(charId: string, owner: PlayerIdx, slot: 0 | 1): Unit {
    const c = CHAR_DEFS[charId];
    if (!c) throw new Error('未知角色 ' + charId);
    const deck: CardInst[] = [];
    for (const [defId, n] of c.deck) for (let i = 0; i < n; i++) deck.push({ uid: 'c' + (++this.state.uidCounter), defId });
    this.shuffle(deck);
    const counters: Record<string, number> = {};
    for (const ct of c.counters ?? []) counters[ct.id] = 0;
    return {
      id: `p${owner}u${slot}`, owner, slot, charId, name: c.name,
      hp: c.hp, maxHp: c.hp, ap: 0, apMax: c.ap, tp: c.tp, tpMax: c.tp, at: c.at, atkCost: c.atkCost, baseSp: c.sp,
      life: 'alive', critical: false, criticalPrev: false, woundedPrev: false, tpMaxDown: 0, spBonus: 0,
      deck, hand: [], discard: [], playing: [], under: [], removed: [],
      attacksThisTurn: 0, advanced: false, buyUsedThisTurn: false,
      dmgReduce: 0, noWound: false, noTpLoss: false, halfTpNext: false, tHp: 0, tTp: 0,
      counters,
    };
  }

  private *setupGen(first: PlayerIdx): Eff {
    const second = (1 - first) as PlayerIdx;
    for (const u of this.state.players[first].units) this.draw(u, 2, true);
    for (const u of this.state.players[second].units) this.draw(u, 3, true);
    yield* this.startTurn(first);
  }

  // ======================================================================
  // 亂數（可重現）
  // ======================================================================
  rand(): number {
    let t = (this.state.seed = (this.state.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  shuffle<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ======================================================================
  // 查詢工具
  // ======================================================================
  unit(id: string): Unit {
    const p = Number(id[1]) as PlayerIdx;
    const s = Number(id[3]) as 0 | 1;
    return this.state.players[p].units[s];
  }
  allUnits(): Unit[] { return [...this.state.players[0].units, ...this.state.players[1].units]; }
  teammate(u: Unit): Unit { return this.state.players[u.owner].units[1 - u.slot]; }
  allies(u: Unit): Unit[] { return this.state.players[u.owner].units.filter(x => x.life !== 'dead'); }
  enemiesOf(owner: PlayerIdx): Unit[] { return this.state.players[1 - owner].units.filter(x => x.life !== 'dead'); }
  effSp(u: Unit): number { return u.life === 'dying' ? -1 : u.baseSp + u.spBonus + (CHAR_DEFS[u.charId].hooks?.spDelta?.(this, u) ?? 0); }
  isWounded(u: Unit): boolean { return u.life === 'alive' && !u.noWound && u.tp <= Math.floor(this.effTpMax(u) / 2); }
  /** 目前的最大 TP（含永久減少，例如[墬淵]），最低 1 */
  effTpMax(u: Unit): number { return Math.max(1, u.tpMax - u.tpMaxDown); }
  /** SP 規則：只能指定敵方 SP 最高的單位（同分皆可） */
  targetableEnemies(owner: PlayerIdx): Unit[] {
    const es = this.enemiesOf(owner);
    if (!es.length) return [];
    const max = Math.max(...es.map(e => this.effSp(e)));
    return es.filter(e => this.effSp(e) === max);
  }
  /** 主動攻擊能選的目標（角色可以用 hooks.enemyTargets 改寫，例如不受 SP 限制） */
  attackTargets(u: Unit): Unit[] {
    return CHAR_DEFS[u.charId].hooks?.enemyTargets?.(this, u) ?? this.targetableEnemies(u.owner);
  }
  /** 這個單位現在可不可以[救治]隊友（有些角色不限次數） */
  rescueAllowed(u: Unit): boolean {
    if (u.life !== 'alive' || this.teammate(u).life !== 'dying') return false;
    return !!CHAR_DEFS[u.charId].rescueUnlimited || !this.state.players[u.owner].rescueUsed;
  }
  /** 實際攻擊力（含角色能力加成） */
  effAt(u: Unit): number { return u.at + (CHAR_DEFS[u.charId].hooks?.atBonus?.(this, u) ?? 0); }
  /** 卡牌實際費用 */
  cardCost(u: Unit, defId: string): number { const d = CARD_DEFS[defId]; return Math.max(0, d.costFor ? d.costFor(this, u) : d.cost); }
  counter(u: Unit, id: string): number { return u.counters[id] ?? 0; }
  addCounter(u: Unit, id: string, n: number) {
    u.counters[id] = (u.counters[id] ?? 0) + n;
    if (n) this.fx({ t: 'counter', unitId: u.id, id, delta: n });
  }

  // ======================================================================
  // 紀錄與特效
  // ======================================================================
  log(text: string, side?: PlayerIdx) { this.state.log.push({ turn: this.state.turn, text, side }); }
  fx(e: FxBody) { this.state.fx.push({ ...e, s: this.snapAll() } as any); }
  snapAll(): UnitSnap[] {
    return this.allUnits().map(u => ({
      id: u.id, hp: u.hp, tp: u.tp, ap: u.ap, tHp: u.tHp, life: u.life, critical: u.critical, spBonus: u.spBonus,
      dmgReduce: u.dmgReduce, noWound: u.noWound, noTpLoss: u.noTpLoss, halfTpNext: u.halfTpNext,
      counters: { ...u.counters }, tpMaxDown: u.tpMaxDown, under: u.under.length, deck: u.deck.length, discard: u.discard.length,
      discardTop: u.discard.length ? u.discard[u.discard.length - 1].defId : null, hand: u.hand.length,
    }));
  }

  // ======================================================================
  // 流程控制
  // ======================================================================
  private run(gen: Eff<any>) {
    this.gen = gen;
    this.step(undefined);
  }
  private step(ans: any) {
    if (!this.gen) return;
    const r = this.gen.next(ans);
    if (r.done) { this.gen = null; this.state.prompt = null; }
    else this.state.prompt = r.value;
    this.checkGameOver();
  }
  private checkGameOver() {
    if (this.state.winner !== null) return;
    const lost = [0, 1].map(p => this.state.players[p].units.every(u => u.life !== 'alive'));
    if (lost[0] || lost[1]) {
      this.state.winner = lost[0] && lost[1] ? 'draw' : (lost[0] ? 1 : 0);
      this.gen = null;
      this.state.prompt = null;
      if (this.state.winner === 'draw') this.log('雙方同時無法行動，平手！');
      else this.log(`${this.state.players[this.state.winner].name} 獲勝！`);
    }
  }

  /** 目前輪到誰操作（有選擇視窗時是被詢問的人） */
  actor(): PlayerIdx | null {
    if (this.state.winner !== null) return null;
    return this.state.prompt ? this.state.prompt.player : this.state.active;
  }

  apply(player: PlayerIdx, action: Action): ApplyResult {
    const st = this.state;
    if (st.winner !== null) return { ok: false, error: '遊戲已結束' };
    st.fx = [];
    st.fxSeq++;
    if (st.prompt) {
      if (action.type !== 'answer') return { ok: false, error: '請先完成目前的選擇' };
      if (st.prompt.player !== player) return { ok: false, error: '不是你的選擇' };
      const v = this.validateAnswer(st.prompt, action.value);
      if (v === undefined) return { ok: false, error: '選擇無效' };
      this.step(v);
      return { ok: true };
    }
    if (action.type === 'answer') return { ok: false, error: '目前沒有要選擇的東西' };
    if (player !== st.active) return { ok: false, error: '還沒輪到你' };
    const err = this.checkAction(player, action);
    if (err) return { ok: false, error: err };
    this.run(this.actionGen(player, action));
    return { ok: true };
  }

  private validateAnswer(p: Prompt, v: Answer): any {
    switch (p.kind) {
      case 'unit': return typeof v === 'string' && p.unitIds.includes(v) ? v : undefined;
      case 'cards': {
        if (!Array.isArray(v)) return undefined;
        const set = new Set(v);
        if (set.size !== v.length || v.length < p.min || v.length > p.max) return undefined;
        return v.every(x => p.cardUids.includes(x)) ? v : undefined;
      }
      case 'confirm': return typeof v === 'boolean' ? v : undefined;
      case 'option': return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < p.options.length ? v : undefined;
      case 'number': return typeof v === 'number' && Number.isInteger(v) && v >= p.min && v <= p.max ? v : undefined;
    }
  }

  /** 回傳錯誤訊息；合法則回傳 null */
  checkAction(player: PlayerIdx, a: Action): string | null {
    if (a.type === 'endTurn') return null;
    if (a.type === 'answer') return '無效';
    const u = this.safeUnit(a.unitId);
    if (!u || u.owner !== player) return '不是你的角色';
    if (u.life !== 'alive') return '這個角色無法行動';
    switch (a.type) {
      case 'play': {
        const c = u.hand.find(x => x.uid === a.cardUid);
        if (!c) return '手牌中沒有這張牌';
        if (u.ap < this.cardCost(u, c.defId)) return 'AP 不足';
        return null;
      }
      case 'playUnder': {
        if (!CHAR_DEFS[u.charId].canPlayUnder) return '這個角色不能使用下方的牌';
        const c = u.under.find(x => x.uid === a.cardUid);
        if (!c) return '沒有這張牌';
        if (u.ap < this.cardCost(u, c.defId)) return 'AP 不足';
        return null;
      }
      case 'attack': {
        const h = CHAR_DEFS[u.charId].hooks;
        if (CHAR_DEFS[u.charId].noAttack) return '這個角色不能主動攻擊';
        if (h?.canAttack && !h.canAttack(this, u)) return '沒有足夠的攻擊資源';
        if (u.attacksThisTurn >= (h?.attackLimit?.(this, u) ?? 1)) return '這回合已經主動攻擊過了';
        if (u.ap < (h?.attackApCost?.(this, u) ?? u.atkCost)) return 'AP 不足';
        if (!this.attackTargets(u).length) return '沒有可攻擊的目標';
        return null;
      }
      case 'advance':
        if (u.advanced) return '這回合已經居前過了';
        if (u.ap < 1) return 'AP 不足';
        return null;
      case 'rescue': {
        if (!CHAR_DEFS[u.charId].rescueUnlimited && this.state.players[player].rescueUsed) return '救治一局只能用一次';
        const ally = this.teammate(u);
        if (ally.life !== 'dying') return '沒有瀕死的隊友';
        const cost = ally.tp * 2;
        if (u.hp - 1 + u.ap < cost) return `HP+AP 不足（需要 ${cost}，且 HP 至少留 1）`;
        return null;
      }
      case 'ability': {
        const ab = CHAR_DEFS[u.charId].abilities.find(x => x.id === a.abilityId);
        if (!ab || !ab.active || !ab.use) return '沒有這個能力';
        if (ab.canUse && !ab.canUse(this, u)) return '現在無法使用';
        return null;
      }
    }
    return '未知操作';
  }
  private safeUnit(id: string): Unit | null {
    if (!/^p[01]u[01]$/.test(id)) return null;
    return this.unit(id);
  }

  private *actionGen(player: PlayerIdx, a: Action): Eff {
    switch (a.type) {
      case 'endTurn': yield* this.endTurn(); return;
      case 'play': {
        const u = this.unit(a.unitId);
        const idx = u.hand.findIndex(x => x.uid === a.cardUid);
        const card = u.hand.splice(idx, 1)[0];
        u.playing.push(card);
        const d = CARD_DEFS[card.defId];
        const cost = this.cardCost(u, card.defId);
        u.ap -= cost;
        this.log(`${u.name} 打出【${d.name}】（-${cost} AP）`, u.owner);
        this.fx({ t: 'play', unitId: u.id, defId: d.id, uid: card.uid });
        yield* d.play(this, u);
        u.playing.splice(u.playing.indexOf(card), 1);
        const rm = typeof d.removeAfterPlay === 'function' ? d.removeAfterPlay(this, u) : !!d.removeAfterPlay;
        if (rm) u.removed.push(card); // 使用後移出牌局
        else u.discard.push(card); // 打出的牌進棄牌區（不算「棄牌」）
        this.fx({ t: 'playEnd', unitId: u.id, defId: d.id, removed: rm });
        return;
      }
      case 'playUnder': {
        const u = this.unit(a.unitId);
        const idx = u.under.findIndex(x => x.uid === a.cardUid);
        const cost = this.cardCost(u, u.under[idx].defId); // 先算費用（拿走後吞噬數會變少）
        const card = u.under.splice(idx, 1)[0];
        u.playing.push(card);
        const d = CARD_DEFS[card.defId];
        u.ap -= cost;
        this.log(`${u.name} 使用${CHAR_DEFS[u.charId].underName ?? '下方'}的【${d.name}】（-${cost} AP）`, u.owner);
        this.fx({ t: 'play', unitId: u.id, defId: d.id, uid: card.uid, fromUnder: true });
        yield* d.play(this, u);
        u.playing.splice(u.playing.indexOf(card), 1);
        u.discard.push(card);
        this.fx({ t: 'playEnd', unitId: u.id, defId: d.id });
        CHAR_DEFS[u.charId].hooks?.afterPlayUnder?.(this, u);
        return;
      }
      case 'attack': {
        const u = this.unit(a.unitId);
        const h = CHAR_DEFS[u.charId].hooks;
        u.ap -= h?.attackApCost?.(this, u) ?? u.atkCost;
        u.attacksThisTurn++;
        h?.onAttack?.(this, u);
        const t = yield* this.chooseEnemy(u, `${u.name} 普攻：選擇目標`);
        if (!t) return;
        this.log(`${u.name} 普攻 ${t.name}`, u.owner);
        const dmg = this.strikeOnce(u, t, h?.strikeOpts?.(this, u));
        h?.onAttackHit?.(this, u, t, dmg);
        return;
      }
      case 'advance': {
        const u = this.unit(a.unitId);
        u.ap -= 1;
        u.advanced = true;
        u.spBonus = 1;
        this.log(`${u.name} [居前]，SP+1`, u.owner);
        this.fx({ t: 'status', unitId: u.id, text: 'SP+1' });
        return;
      }
      case 'rescue': {
        const u = this.unit(a.unitId);
        const ally = this.teammate(u);
        const cost = ally.tp * 2;
        const minAp = Math.max(0, cost - (u.hp - 1));
        const maxAp = Math.min(u.ap, cost);
        let apPay = minAp;
        if (maxAp > minAp) {
          apPay = yield { kind: 'number', player, title: `救治 ${ally.name}：共需支付 ${cost}（HP+AP），要用多少 AP？剩下的扣 HP`, min: minAp, max: maxAp, label: 'AP' };
        }
        const hpPay = cost - apPay;
        u.ap -= apPay;
        u.hp -= hpPay;
        if (hpPay) this.fx({ t: 'damage', unitId: u.id, amount: hpPay });
        if (!CHAR_DEFS[u.charId].rescueUnlimited) this.state.players[player].rescueUsed = true; // 不限次數的角色不佔用一局一次的額度
        this.log(`${u.name} 支付 ${apPay} AP + ${hpPay} HP，[救治] ${ally.name}`, u.owner);
        this.reviveUnit(ally, cost);
        return;
      }
      case 'ability': {
        const u = this.unit(a.unitId);
        const ab = CHAR_DEFS[u.charId].abilities.find(x => x.id === a.abilityId)!;
        this.log(`${u.name} 發動能力：${ab.name}`, u.owner);
        yield* ab.use!(this, u);
        return;
      }
    }
  }

  // ======================================================================
  // 回合
  // ======================================================================
  private *startTurn(p: PlayerIdx): Eff {
    const st = this.state;
    const ps = st.players[p];
    ps.turnCount++;
    ps.discardsThisTurn = 0;
    st.turn++;
    st.active = p;
    this.log(`—— 第 ${st.turn} 回合：${ps.name} ——`, p);
    for (const u of ps.units) {
      if (u.life === 'dead') continue;
      u.criticalPrev = u.critical; // 記下「上回合是否處於[重創]」，再重算
      u.woundedPrev = this.isWounded(u); // 記下「上回合是否[負傷]」（用回滿 TP 之前的數值）
      u.tHp = 0; u.tTp = 0; u.dmgReduce = 0; u.noWound = false; u.noTpLoss = false;
      u.spBonus = 0; u.attacksThisTurn = 0; u.advanced = false; u.buyUsedThisTurn = false;
      if (u.life === 'alive') {
        if (u.halfTpNext) {
          u.tp = Math.ceil(this.effTpMax(u) / 2);
          this.log(`${u.name} 受到影響，只回復一半 TP（${u.tp}）`, p);
        } else u.tp = this.effTpMax(u);
        u.halfTpNext = false;
        u.critical = u.tp === 0;
        u.ap = Math.min(2 * ps.turnCount, u.apMax);
      } else {
        u.ap = 0;
      }
    }
    this.fx({ t: 'turn', player: p });
    // 掛在單位身上的狀態：自己回合開始（例如[聖環]解除）
    for (const u of ps.units) {
      for (const s of Object.values(STATUS_DEFS)) if ((u.counters[s.id] ?? 0) > 0) s.onTurnStart?.(this, u);
    }
    for (const u of ps.units) {
      if (u.life !== 'alive') continue;
      CHAR_DEFS[u.charId].hooks?.onTurnStartBeforeDraw?.(this, u);
      this.draw(u, 1, true);
    }
  }

  private *endTurn(): Eff {
    const st = this.state;
    const p = st.active;
    for (const e of st.endOfTurn) END_OF_TURN[e.kind]?.(this, this.unit(e.by));
    st.endOfTurn = [];
    // 回合結束時的角色效果（例如拉尼斯可以移除手牌）
    for (const u of st.players[p].units) {
      if (u.life !== 'alive') continue;
      const r = CHAR_DEFS[u.charId].hooks?.onOwnTurnEnd?.(this, u);
      if (r) yield* r;
    }
    // 掛在單位身上的狀態：自己回合結束（例如[聖環]回復 1 HP）
    for (const u of st.players[p].units) {
      if (u.life !== 'alive') continue;
      for (const s of Object.values(STATUS_DEFS)) if ((u.counters[s.id] ?? 0) > 0) s.onTurnEnd?.(this, u);
    }
    this.log(`${st.players[p].name} 結束回合`, p);
    yield* this.startTurn((1 - p) as PlayerIdx);
  }

  // ======================================================================
  // 牌的移動
  // ======================================================================
  /** 抽牌；牌組空了就把棄牌區洗回去。瀕死／死亡的角色不能抽牌 */
  draw(u: Unit, n: number, silent = false): number {
    if (u.life !== 'alive' || n <= 0) return 0;
    let got = 0;
    for (let i = 0; i < n; i++) {
      if (!u.deck.length) {
        if (!u.discard.length) break;
        u.deck = u.discard;
        u.discard = [];
        this.shuffle(u.deck);
        this.log(`${u.name} 的牌組用完，棄牌區洗回牌組`, u.owner);
        this.fx({ t: 'reshuffle', unitId: u.id });
      }
      const c = u.deck.pop()!;
      u.hand.push(c);
      got++;
      this.fx({ t: 'draw', unitId: u.id, uid: c.uid });
      CARD_DEFS[c.defId]?.onDrawCard?.(this, u, c); // 「抽出此牌時」的效果
    }
    if (!silent && got) this.log(`${u.name} 抽 ${got} 張牌`, u.owner);
    return got;
  }

  /** 棄置指定手牌（效果造成的棄牌）：觸發「我方棄牌」被動與該牌的(棄置時)效果 */
  *discardCards(u: Unit, uids: string[]): Eff {
    for (const uid of uids) {
      const i = u.hand.findIndex(c => c.uid === uid);
      if (i < 0) continue;
      const card = u.hand.splice(i, 1)[0];
      u.discard.push(card);
      const d = CARD_DEFS[card.defId];
      this.log(`${u.name} 棄置【${d.name}】`, u.owner);
      this.fx({ t: 'discard', unitId: u.id, uid: card.uid, defId: card.defId });
      this.state.players[u.owner].discardsThisTurn++;
      for (const ally of this.allies(u)) {
        const r = CHAR_DEFS[ally.charId].hooks?.onAllyDiscard?.(this, ally, u, card);
        if (r) yield* r;
      }
      if (d.onDiscard) yield* d.onDiscard(this, u, card);
    }
  }

  /** [洗牌]：能力、卡牌效果造成的洗牌＝棄牌區洗回牌組，再抽 1 張（牌組抽完自動洗回不算） */
  abilityShuffle(u: Unit) {
    if (u.life === 'dead') return;
    this.reshuffle(u);
    this.log(`${u.name} [洗牌]`, u.owner);
    for (const ally of this.allies(u)) CHAR_DEFS[ally.charId].hooks?.onAllyShuffle?.(this, ally, u);
    this.draw(u, 1);
  }

  /** 把棄牌區洗回牌組（單純洗回，不抽牌） */
  reshuffle(u: Unit) {
    const had = u.discard.length;
    u.deck.push(...u.discard);
    u.discard = [];
    this.shuffle(u.deck);
    if (had) this.fx({ t: 'reshuffle', unitId: u.id });
  }

  /** [移除]：從牌組最上方把 n 張牌放進棄牌區（「從牌組移除 N 張牌至棄牌區」）：不算抽牌、不算棄牌 */
  mill(u: Unit, n: number): number {
    let k = 0;
    for (let i = 0; i < n && u.deck.length; i++) { u.discard.push(u.deck.pop()!); k++; }
    if (k) {
      this.log(`${u.name} 從牌組移除 ${k} 張牌至棄牌區`, u.owner);
      this.fx({ t: 'mill', unitId: u.id, n: k });
    }
    return k;
  }

  /** [移除]手牌至棄牌區：直接放進棄牌區，不算「棄牌」（不觸發棄牌相關的被動和(棄置時)） */
  millHand(u: Unit, uids: string[]): number {
    let k = 0;
    for (const uid of uids) {
      const i = u.hand.findIndex(c => c.uid === uid);
      if (i < 0) continue;
      const card = u.hand.splice(i, 1)[0];
      u.discard.push(card);
      this.fx({ t: 'discard', unitId: u.id, uid: card.uid, defId: card.defId });
      k++;
    }
    if (k) this.log(`${u.name} 將 ${k} 張手牌移除至棄牌區`, u.owner);
    return k;
  }

  /** 把指定的手牌移出牌局（不進棄牌區） */
  removeHandCards(u: Unit, uids: string[]): number {
    let k = 0;
    for (const uid of uids) {
      const i = u.hand.findIndex(c => c.uid === uid);
      if (i < 0) continue;
      const card = u.hand.splice(i, 1)[0];
      u.removed.push(card);
      this.fx({ t: 'remove', unitId: u.id, defId: card.defId, uid: card.uid, from: 'hand' });
      k++;
    }
    return k;
  }

  /** 從牌組最上方把 n 張牌移出牌局 */
  removeDeckTop(u: Unit, n: number): number {
    let k = 0;
    for (let i = 0; i < n && u.deck.length; i++) {
      const card = u.deck.pop()!;
      u.removed.push(card);
      this.fx({ t: 'remove', unitId: u.id, defId: card.defId, from: 'deck' });
      k++;
    }
    if (k) this.log(`${u.name} 從牌組將 ${k} 張牌[移出牌局]`, u.owner);
    return k;
  }

  // ======================================================================
  // 傷害、TP、狀態
  // ======================================================================
  /**
   * [打擊]一次：造成 AT 點傷害並 -1 TP。
   * opts.direct = [直擊]：傷害照算，但不會減少對方 TP
   * opts.power = 用指定數值取代 AT（例如「造成焰能數 ×2 的直擊」）
   */
  strikeOnce(src: Unit, tgt: Unit, opts?: { direct?: boolean; power?: number }): number {
    if (tgt.life === 'dead') return 0;
    this.fx({ t: 'strike', unitId: src.id, targetId: tgt.id });
    const dmg = this.attackHit(src, tgt, opts?.power ?? this.effAt(src), true, opts?.direct);
    CHAR_DEFS[src.charId].hooks?.onStrike?.(this, src);
    return dmg;
  }
  strike(src: Unit, tgt: Unit, times: number, opts?: { direct?: boolean; power?: number }) {
    for (let i = 0; i < times; i++) {
      if (tgt.life === 'dead' || this.state.winner !== null) break;
      this.strikeOnce(src, tgt, opts);
    }
  }

  /** 一次攻擊命中，回傳對 HP 造成的傷害。direct = [直擊]（不減少 TP） */
  attackHit(src: Unit, tgt: Unit, base: number, isStrike: boolean, direct = false): number {
    if (tgt.life === 'dead') return 0;
    if (tgt.life === 'dying') {
      const dmg = Math.max(0, base - tgt.dmgReduce);
      const loss = 1 + Math.floor(dmg / 4);
      this.log(`${tgt.name}（瀕死）受到攻擊，TP -${loss}`, src.owner);
      this.dyingTpLoss(tgt, loss);
      return 0;
    }
    const wounded = this.isWounded(tgt);
    const dmg = Math.max(0, base + (wounded ? 1 : 0) - tgt.dmgReduce);
    const extra = [wounded ? '負傷+1' : '', tgt.dmgReduce ? `減傷-${tgt.dmgReduce}` : ''].filter(Boolean).join('、');
    this.log(`${tgt.name} 受到 ${dmg} 點傷害${extra ? `（${extra}）` : ''}`, src.owner);
    this.dealHp(tgt, dmg);
    if (isStrike && !direct && tgt.life === 'alive') this.loseTp(tgt, 1);
    return dmg;
  }

  /** 扣 HP（臨時 HP 先扣），歸零進入[瀕死] */
  dealHp(u: Unit, n: number) {
    if (u.life !== 'alive' || n <= 0) return;
    const absorbed = Math.min(u.tHp, n);
    u.tHp -= absorbed;
    n -= absorbed;
    u.hp -= n;
    this.fx({ t: 'damage', unitId: u.id, amount: n + absorbed });
    if (u.hp <= 0) this.enterDying(u);
  }

  /**
   * 回復 HP。raw = 不套用狀態的治療加成（例如[聖環]自己回合結束的回復）。
   * 狀態的治療加成（[聖環]「受到治療時回復 1」）直接加在這次治療量上。
   */
  heal(u: Unit, n: number, raw = false) {
    if (u.life !== 'alive' || n <= 0) return;
    if (!raw) for (const s of Object.values(STATUS_DEFS)) if ((u.counters[s.id] ?? 0) > 0) n += s.healBonus?.(this, u) ?? 0;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + n);
    const got = u.hp - before;
    if (!got) return; // 滿血就不記錄
    this.log(`${u.name} 回復 ${got} HP`, u.owner);
    this.fx({ t: 'heal', unitId: u.id, amount: got });
    // 我方單位回復 HP 時的被動（例如米雅抽牌）
    for (const a of this.allies(u)) CHAR_DEFS[a.charId].hooks?.onAllyHeal?.(this, a, u, got);
  }

  /**
   * [救治]的結果：[瀕死]單位以 hp 點 HP 回歸（不超過最大 HP），當回合不能再行動。
   * 一般救治和效果造成的救治（例如「無條件救治」）都用這個。
   */
  reviveUnit(u: Unit, hp: number) {
    if (u.life !== 'dying') return;
    u.life = 'alive';
    u.hp = Math.max(1, Math.min(u.maxHp, hp));
    u.critical = u.tp === 0;
    u.ap = 0;
    u.attacksThisTurn = 999; u.advanced = true; // 被救治的角色當回合不能再行動
    this.log(`${u.name} 以 ${u.hp} HP 回歸！`, u.owner);
    this.fx({ t: 'heal', unitId: u.id, amount: u.hp });
  }

  /** 減少 TP（打擊或效果）。TP 歸零 → [重創]：-3 HP 直傷 */
  loseTp(u: Unit, n: number) {
    if (u.life === 'dead' || n <= 0) return;
    if (u.life === 'dying') { this.dyingTpLoss(u, n); return; }
    if (u.noTpLoss) { this.log(`${u.name} 不會減少 TP（恕不退款）`, u.owner); return; }
    const absorbed = Math.min(u.tTp, n);
    u.tTp -= absorbed;
    n -= absorbed;
    const wasWounded = this.isWounded(u);
    u.tp = Math.max(0, u.tp - n);
    this.fx({ t: 'tp', unitId: u.id, amount: n });
    if (u.tp === 0 && !u.critical) {
      u.critical = true;
      u.spBonus = 0;
      this.log(`${u.name} 陷入[重創]！-3 HP（直傷）`, u.owner);
      this.fx({ t: 'status', unitId: u.id, text: '重創' });
      this.dealHp(u, 3);
      // 「任一單位進入[重創]」的被動（例如給予[墬淵]、瀆神海域的額外直傷）
      for (const src of this.allUnits()) {
        if (src.life === 'alive') CHAR_DEFS[src.charId].hooks?.onUnitCritical?.(this, src, u);
      }
    } else if (!wasWounded && this.isWounded(u)) {
      this.log(`${u.name} 陷入[負傷]`, u.owner);
      this.fx({ t: 'status', unitId: u.id, text: '負傷' });
    }
  }

  /** 直接[處決]瀕死單位 */
  executeUnit(u: Unit) {
    if (u.life !== 'dying') return;
    this.dyingTpLoss(u, u.tp);
  }

  private dyingTpLoss(u: Unit, n: number) {
    u.tp -= n;
    this.fx({ t: 'tp', unitId: u.id, amount: n });
    if (u.tp <= 0) {
      u.tp = 0;
      u.life = 'dead';
      this.log(`${u.name} 被[處決]，逐出本牌局！`, u.owner);
      this.fx({ t: 'status', unitId: u.id, text: '處決' });
    }
  }

  private enterDying(u: Unit) {
    u.hp = 0;
    u.life = 'dying';
    u.tp = this.effTpMax(u);
    u.critical = false;
    u.spBonus = 0;
    u.tHp = 0;
    u.tTp = 0;
    this.log(`${u.name} 進入[瀕死]！`, u.owner);
    this.fx({ t: 'status', unitId: u.id, text: '瀕死' });
  }

  // ======================================================================
  // 給卡牌用的選擇工具
  // ======================================================================
  *chooseUnit(player: PlayerIdx, title: string, units: Unit[]): Eff<Unit | null> {
    if (!units.length) return null;
    if (units.length === 1) return units[0];
    const id: string = yield { kind: 'unit', player, title, unitIds: units.map(x => x.id) };
    return this.unit(id);
  }
  *chooseEnemy(u: Unit, title: string): Eff<Unit | null> {
    return yield* this.chooseUnit(u.owner, title, this.attackTargets(u));
  }
  *chooseAlly(u: Unit, title: string): Eff<Unit | null> {
    return yield* this.chooseUnit(u.owner, title, this.state.players[u.owner].units.filter(x => x.life === 'alive'));
  }
  *chooseHandCards(u: Unit, title: string, min: number, max: number): Eff<string[]> {
    const n = u.hand.length;
    min = Math.min(min, n);
    max = Math.min(max, n);
    if (max === 0) return [];
    if (min === max && max === n) return u.hand.map(c => c.uid);
    return yield { kind: 'cards', player: u.owner, title, unitId: u.id, cardUids: u.hand.map(c => c.uid), min, max };
  }
  *confirm(player: PlayerIdx, title: string, yes = '是', no = '否'): Eff<boolean> {
    return yield { kind: 'confirm', player, title, yes, no };
  }
  *option(player: PlayerIdx, title: string, options: string[]): Eff<number> {
    return yield { kind: 'option', player, title, options };
  }
}
