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
  counters?: { id: string; name: string }[]; // 例如 財富
  abilities: AbilityDef[];
  deck: [string, number][];
  hooks?: {
    /** 回合開始、正常抽牌之前 */
    onTurnStartBeforeDraw?(g: Game, u: Unit): void;
    /** 我方任一單位棄牌時（每張觸發一次），u = 擁有此能力的單位 */
    onAllyDiscard?(g: Game, u: Unit, discarder: Unit, card: CardInst): void;
    /** 此單位發動[收買]後 */
    onBuy?(g: Game, u: Unit): void;
  };
}

export const CARD_DEFS: Record<string, CardDef> = {};
export const CHAR_DEFS: Record<string, CharDef> = {};

export function registerChar(c: CharDef, cards: CardDef[]) {
  CHAR_DEFS[c.id] = c;
  for (const card of cards) CARD_DEFS[card.id] = card;
}
