import type { Unit, Prompt, CardInst } from './types';
import type { Game } from './game';

/** 效果是 generator：遇到需要玩家選擇時 yield 一個 Prompt，拿到答案再繼續 */
export type Eff<T = void> = Generator<Prompt, T, any>;

export interface CardDef {
  id: string;
  charId: string;
  name: string;
  cost: number;
  text: string;          // 打出效果說明
  /** 依情況變動的費用（沒寫就是 cost） */
  costFor?(g: Game, u: Unit): number;
  discardText?: string;  // (棄置時) 效果說明
  play(g: Game, u: Unit): Eff;
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
  hp: number;
  ap: number;
  tp: number;
  at: number;
  atkCost: number;
  sp: number;
  counters?: { id: string; name: string; hidden?: boolean }[]; // 例如 財富
  /** 可以使用壓在下方的牌（葛蘭妮） */
  canPlayUnder?: boolean;
  underName?: string; // 下方牌堆的名稱，例如「吞噬」
  abilities: AbilityDef[];
  deck: [string, number][];
  hooks?: {
    /** 回合開始、正常抽牌之前 */
    onTurnStartBeforeDraw?(g: Game, u: Unit): void;
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
    canAttack?(g: Game, u: Unit): boolean;
    /** 主動攻擊成立、扣完費用之後（用來扣專屬資源或觸發「首次攻擊」效果） */
    onAttack?(g: Game, u: Unit): void;
    /** 主動攻擊時那一次[打擊]的設定（例如改成[直擊]、或用指定數值取代 AT） */
    strikeOpts?(g: Game, u: Unit): { direct?: boolean; power?: number };
    /** 主動攻擊命中之後，t = 目標、dmg = 這次對 HP 造成的傷害 */
    onAttackHit?(g: Game, u: Unit, t: Unit, dmg: number): void;
    /** 使用下方的牌之後 */
    afterPlayUnder?(g: Game, u: Unit): void;
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
