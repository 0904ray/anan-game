// 遊戲規則引擎的對外入口：畫面、連線、測試都只從這裡 import
import './chars';
export { Game, type ApplyResult } from './game';
export { CARD_DEFS, CHAR_DEFS, STATUS_DEFS, type CardDef, type CharDef, type AbilityDef, type StatusDef } from './defs';
export { viewFor } from './view';
export { KEYWORDS, findKeyword, keywordBase, keywordNames, type KeywordDef, type KeywordCat } from './keywords';
export { roster, isValidTeam, randomTeam, type Team } from './roster';
export { legalActions, randomAnswer, botStep } from './bot';
export type * from './types';
