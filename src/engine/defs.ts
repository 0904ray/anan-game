import type { Unit, Prompt, CardInst } from './types';
import type { Game } from './game';

/** 效果是 generator：遇到需要玩家選擇時 yield 一個 Prompt，拿到答案再繼續 */
export type Eff<T = void> = Generator<Prompt, T, any>;

/** 手牌費用的支付明細：哪個單位各付了幾張（異端物用） */
export interface HandPaid { unitId: string; n: number }
/** 打出卡牌時附帶的支付資訊（目前只有手牌費用） */
export interface PlayPay { handPaid?: HandPaid[] }

export interface CardDef {
  id: string;
  charId: string;
  name: string;
  cost: number;
  text: string;          // 打出效果說明
  /** 依情況變動的費用（沒寫就是 cost） */
  costFor?(g: Game, u: Unit): number;
  discardText?: string;  // (棄置時) 效果說明
  play(g: Game, u: Unit, pay?: PlayPay): Eff;
  /** (抽出時) 效果說明：卡面會畫在效果文字前面，寫法和 discardText 一樣 */
  drawText?: string;
  /** (抽出時) 抽到手上的當下結算（含開局抽牌）；不是 generator，不能要求玩家選擇 */
  onDrawCard?(g: Game, u: Unit, card: CardInst): void;
  /** 使用後移出牌局：不進棄牌區，也不會再被洗回牌組（也可以寫成函式，依使用次數等條件決定） */
  removeAfterPlay?: boolean | ((g: Game, u: Unit) => boolean);
  onDiscard?(g: Game, u: Unit, card: CardInst): Eff;
}

export interface AbilityDef {
  id: string;
  name: string;
  text: string;
  active: boolean;                       // true = 可以按的主動能力
  canUse?(g: Game, u: Unit): boolean;
  use?(g: Game, u: Unit): Eff;
}

export interface CharDef {
  id: string;
  name: string;
  title: string;      // 概要
  lore: string;       // 記事
  /** 做到一半、還不想出現在選角畫面的角色設 true */
  hidden?: boolean;
  /** 角色主題色（CSS 顏色）：卡面細框、名稱條底線、牌堆外框。沒寫用金色 */
  theme?: string;
  /**
   * 型態立繪：單位的 counters[counter] > 0 時，頭像換成 assets/chars/<角色id>_<id>（沒有圖就用一般立繪）。
   * 例如異端物的[異方侵入]／[超越此方]。
   */
  forms?: { id: string; name: string; counter: string }[];
  /** 圖片色調校正（CSS filter），給畫風偏淡或偏暗的角色用，例如 'contrast(1.2) saturate(1.3)'；會疊在牌桌的色調層次上，套用到這個角色的卡圖和頭像 */
  artTone?: string;
  hp: number;
  ap: number;
  tp: number;
  at: number;
  atkCost: number;
  sp: number;
  counters?: { id: string; name: string; hidden?: boolean }[]; // 例如 財富
  /** 角色專屬詞條的說明（卡面上用 [詞] 標起來的詞），例如 { 財富: '…' }。長按放大卡牌時會顯示 */
  keywords?: Record<string, string>;
  /** 可以使用壓在下方的牌（葛蘭妮） */
  canPlayUnder?: boolean;
  underName?: string; // 下方牌堆的名稱，例如「吞噬」
  /** 不能主動攻擊（普攻）：畫面不顯示普攻按鈕，AT／普攻花費也不顯示 */
  noAttack?: boolean;
  /** [救治]不限次數：不佔用、也不消耗一局一次的額度 */
  rescueUnlimited?: boolean;
  /** [救治]的總花費（HP＋AP）改寫；沒寫就是隊友目前 TP × 2 */
  rescueCost?(g: Game, u: Unit, ally: Unit): number;
  /** [不屈]：這個單位[瀕死]時依然可以行動，SP 也不會變成 -1 */
  unyielding?: boolean;
  /** 選角畫面的 AT 顯示文字（AT 會變動的角色用，例如「AT X（＝當前 TP）」） */
  atText?: string;
  /** 卡牌費用改用「手牌數」支付（HS）：不花 AP，打出時從我方手牌移除等同費用的牌 */
  costAs?: 'hand';
  /** 畫面上[主動攻擊]按鈕的花費文字（沒寫就是 AP 花費數字，例如異端物的「全手牌」） */
  attackCostText?: string;
  abilities: AbilityDef[];
  deck: [string, number][];
  hooks?: {
    /** 回合開始、正常抽牌之前 */
    onTurnStartBeforeDraw?(g: Game, u: Unit): Eff | void;
    /** 我方任一單位棄牌時（每張觸發一次），u = 擁有此能力的單位。可以回傳 Eff 讓玩家做選擇 */
    onAllyDiscard?(g: Game, u: Unit, discarder: Unit, card: CardInst): Eff | void;
    /** 額外 AT */
    atBonus?(g: Game, u: Unit): number;
    /** 此單位每打擊一次之後 */
    onStrike?(g: Game, u: Unit): void;
    /** 每回合最多主動攻擊幾次（沒寫就是 1） */
    attackLimit?(g: Game, u: Unit): number;
    /** 主動攻擊要花多少 AP（沒寫就是 u.atkCost） */
    attackApCost?(g: Game, u: Unit): number;
    /** 主動攻擊的其他限制（例如專屬資源不足就不能攻擊） */
    /** 現在能不能主動攻擊；回傳字串＝不能，並把字串當成提示（例如「打出[異方侵入]前不能主動攻擊」） */
    canAttack?(g: Game, u: Unit): boolean | string;
    /** 主動攻擊成立、扣完費用之後（用來扣專屬資源或觸發「首次攻擊」效果） */
    onAttack?(g: Game, u: Unit): void;
    /** 主動攻擊時那一次[打擊]的設定（例如改成[直擊]、或用指定數值取代 AT） */
    strikeOpts?(g: Game, u: Unit): { direct?: boolean; power?: number };
    /** 主動攻擊命中之後，t = 目標、dmg = 這次對 HP 造成的傷害 */
    onAttackHit?(g: Game, u: Unit, t: Unit, dmg: number): void;
    /** 使用下方的牌之後 */
    afterPlayUnder?(g: Game, u: Unit): void;
    /** 我方（任一單位）[洗牌]之後；u = 擁有此能力的單位，shuffled = 洗牌的那個單位 */
    onAllyShuffle?(g: Game, u: Unit, shuffled: Unit): void;
    /** 任一單位進入[重創]之後；u = 擁有此能力的單位，target = 進入[重創]的單位 */
    onUnitCritical?(g: Game, u: Unit, target: Unit): void;
    /** 我方（任一單位）實際回復 HP 之後；u = 擁有此能力的單位，healed = 被治療的單位，amount = 實際回復量 */
    onAllyHeal?(g: Game, u: Unit, healed: Unit, amount: number): void;
    /** 這個單位損失 HP 之後（受到傷害、支付 HP 代價都算）；amount = 實際損失的 HP */
    onHpLoss?(g: Game, u: Unit, amount: number): void;
    /** 任一單位進入[負傷]之後；u = 擁有此能力的單位，target = 進入[負傷]的單位 */
    onUnitWounded?(g: Game, u: Unit, target: Unit): void;
    /** 自己[打擊]自己（「打擊自身」）時的傷害設定；沒寫就是一般[打擊]的傷害 */
    selfHit?(g: Game, u: Unit): { power: number; noWoundBonus?: boolean };
    /** 自訂[主動攻擊]的整個流程（不是單體[打擊]的角色用）；回傳 true 表示已經處理完，核心不再選目標 */
    attack?(g: Game, u: Unit): Eff<boolean>;
    /** 自己回合開始的正常[起手抽牌]要抽幾張（沒寫就是 1） */
    turnStartDraw?(g: Game, u: Unit): number;
    /** 我方單位（ally）回合開始、正常抽牌之前；回傳 true 表示已取代這次抽牌（例如改成檢索），不再正常抽牌 */
    onAllyStartDraw?(g: Game, u: Unit, ally: Unit): Eff<boolean>;
    /** 一次手牌被[移除]至棄牌區之後（支付手牌費用、掃場等）；u = 擁有此能力的單位，removals = 哪些單位各被移除幾張 */
    onHandRemoved?(g: Game, u: Unit, removals: HandPaid[]): void;
    /** SP 加減（例如「隊友有[聖環]時 SP -1」） */
    spDelta?(g: Game, u: Unit): number;
    /** 自己的回合結束時（切換到下一位玩家之前），可以回傳 Eff 讓玩家做選擇 */
    onOwnTurnEnd?(g: Game, u: Unit): Eff | void;
    /** 這個角色能指定的敵方單位（沒寫就是 SP 限制）；主動攻擊、卡牌指定敵方都用這個 */
    enemyTargets?(g: Game, u: Unit): Unit[];
  };
}

export const CARD_DEFS: Record<string, CardDef> = {};
export const CHAR_DEFS: Record<string, CharDef> = {};

/**
 * 「本回合結束時」的延遲效果。卡牌用 g.state.endOfTurn.push({ kind, by }) 排進去，
 * 回合結束時由核心呼叫對應的處理函式（核心不需要知道任何角色的細節）。
 */
export const END_OF_TURN: Record<string, (g: Game, by: Unit) => void> = {};
export function registerEndOfTurn(kind: string, fn: (g: Game, by: Unit) => void) {
  END_OF_TURN[kind] = fn;
}

export function registerChar(c: CharDef, cards: CardDef[]) {
  CHAR_DEFS[c.id] = c;
  for (const card of cards) CARD_DEFS[card.id] = card;
}

/**
 * 掛在單位 counters 上的共用狀態（例如[墬淵]）：畫面會自動顯示成徽章，
 * 不需要在畫面寫任何角色專屬的判斷。
 */
export interface StatusDef {
  id: string;
  name: string;
  /** 治療加成：這個單位被治療時額外回復的量（例如[聖環]的「受到治療時回復 1 HP」） */
  healBonus?(g: Game, u: Unit): number;
  /** 自己回合開始時（抽牌前） */
  onTurnStart?(g: Game, u: Unit): void;
  /** 自己回合結束時（切換到下一位玩家之前） */
  onTurnEnd?(g: Game, u: Unit): void;
}
export const STATUS_DEFS: Record<string, StatusDef> = {};
export function registerStatus(s: StatusDef) { STATUS_DEFS[s.id] = s; }
