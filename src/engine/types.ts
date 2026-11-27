// ===== 遊戲狀態的資料結構（純資料，可以直接 JSON 傳給對手） =====

export type PlayerIdx = 0 | 1;

export interface CardInst {
  uid: string;   // 這張實體牌的唯一編號
  defId: string; // 對應的卡牌定義（隱藏時為 'hidden'）
  costMod?: number; // 這張實體牌的費用修正（例如無方讓手牌裡的攻擊牌 -1 AP）；跟著這張牌一直有效
}

export type LifeState = 'alive' | 'dying' | 'dead';

export interface Unit {
  id: string;          // 例如 "p0u0"
  owner: PlayerIdx;
  slot: 0 | 1;
  charId: string;
  name: string;

  hp: number;
  maxHp: number;
  ap: number;
  apMax: number;
  tp: number;
  tpMax: number;
  at: number;
  atkCost: number;
  baseSp: number;

  life: LifeState;
  critical: boolean;   // 本輪 TP 歸零進入[重創]（-3 HP 已扣）
  criticalPrev: boolean; // 自己上一個回合開始時是否處於[重創]（「上回合有[重創]」的判斷用）
  woundedPrev: boolean;  // 自己上一個回合開始時是否[負傷]（「上回合有[負傷]」的判斷用）
  tpMaxDown: number;   // 永久的最大 TP 減少（[墬淵]）；等效最大 TP = tpMax - tpMaxDown
  spBonus: number;     // [居前] 加成
  hpLink: string | null; // HP 綁定：另一名單位受到的 HP 增減也比照辦理（例如異端物的超越此方）
  tpLink: string | null; // TP 以另一名單位為基準：每次 TP 變動後同步成對方的數值
  noActionTurn: boolean; // 本回合已停止行動（例如異端物掃場之後）

  deck: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  playing: CardInst[]; // 正在結算中的牌
  under: CardInst[];   // 壓在角色下方的牌（例如葛蘭妮吞噬的牌）
  removed: CardInst[]; // 移出牌局的牌（不會再回到牌組或棄牌區）

  // 回合內旗標
  attacksThisTurn: number; // 本回合已主動攻擊幾次（上限由角色 hooks.attackLimit 決定，預設 1）
  advanced: boolean;
  buyUsedThisTurn: boolean;

  // 持續到「下個自身回合開始」的效果
  dmgReduce: number;   // 受到傷害 -X
  noWound: boolean;    // 不會陷入[負傷]
  noTpLoss: boolean;   // 不會減少 TP
  halfTpNext: boolean; // 下次回合開始只回復一半 TP

  tHp: number;
  tTp: number;

  counters: Record<string, number>; // 角色專屬計數，例如 wealth（財富）
}

/**
 * 延後觸發：先排進佇列，等目前這個操作（出牌、攻擊、能力、反擊）結算完，
 * 再一次結算（可以要求玩家選擇）。觸發者可能不是目前回合的玩家（例如在對方回合進入[瀕死]）。
 */
export interface DeferTrigger {
  kind: string;
  by: string;                                   // 觸發者的單位 id（Prompt 的 player 就是他的擁有者）
  data?: Record<string, string | number>;
}

/**
 * 一次「攻擊」的設定：普攻和攻擊牌（有 CardDef.tag 的牌）都各算 1 次攻擊。
 * 角色的 hooks.onAttackStart 在傷害前修正它，hooks.onAttackEnd 在傷害後追加效果。
 * 只活在結算過程中，不會進 GameState。
 */
export interface AttackCtx {
  u: Unit;                  // 攻擊者
  cardId: string | null;    // 這次攻擊用的牌（普攻是 null）
  tag: string | null;       // 那張牌的武器標記（例如 '刀'）
  power: number;            // 這次[打擊]的傷害（不含[負傷]增傷、減傷）
  direct: boolean;          // 這次傷害是[直擊]（不減少 TP）
  fixed: boolean;           // 這次傷害是[直傷]（固定傷害，不吃增傷／減傷、不扣 TP）
  target: Unit | null;      // 這次攻擊的主要目標
  dealt: number;            // 主要傷害實際造成的 HP 傷害合計
  /** 角色 hook 之間傳資料用的暫存欄位（不會進 GameState） */
  data: Record<string, number | string>;
}

export interface PlayerState {
  idx: PlayerIdx;
  name: string;
  units: [Unit, Unit];
  turnCount: number;
  rescueUsed: boolean;
  discardsThisTurn: number; // 我方本回合棄過幾張牌
}

// ===== 等待玩家做選擇 =====
export type Prompt =
  | { kind: 'unit'; player: PlayerIdx; title: string; unitIds: string[] }
  /** 選手牌：cardUids 可以跨我方多個單位的手牌（畫面直接把能選的牌高亮，混著選） */
  | { kind: 'cards'; player: PlayerIdx; title: string; cardUids: string[]; min: number; max: number }
  | { kind: 'confirm'; player: PlayerIdx; title: string; yes: string; no: string }
  | { kind: 'option'; player: PlayerIdx; title: string; options: string[] }
  | { kind: 'number'; player: PlayerIdx; title: string; min: number; max: number; label: string };

export type Answer = string | string[] | number | boolean;

export interface LogEntry {
  turn: number;
  text: string;
  side?: PlayerIdx;
}

/** 事件發生當下每個角色的公開數值（畫面播動畫時照這個一步一步更新） */
export interface UnitSnap {
  id: string;
  hp: number; tp: number; ap: number; tHp: number;
  life: LifeState; critical: boolean; spBonus: number;
  dmgReduce: number; noWound: boolean; noTpLoss: boolean; halfTpNext: boolean;
  counters: Record<string, number>;
  tpMaxDown: number;
  under: number; deck: number; discard: number; discardTop: string | null; hand: number;
}

/** 給畫面做動畫用的事件（依發生順序） */
export type FxBody =
  | { t: 'turn'; player: PlayerIdx }
  | { t: 'draw'; unitId: string; uid: string }
  | { t: 'reshuffle'; unitId: string }
  | { t: 'mill'; unitId: string; n: number } // 從牌組移除 N 張到棄牌區
  | { t: 'remove'; unitId: string; defId: string | null; uid?: string; from: 'hand' | 'deck' } // 移出牌局
  | { t: 'play'; unitId: string; defId: string; uid: string; fromUnder?: boolean }
  | { t: 'playEnd'; unitId: string; defId: string; removed?: boolean }
  | { t: 'discard'; unitId: string; uid: string; defId: string }
  | { t: 'devour'; unitId: string; fromId: string; uid: string; defId: string; src: 'hand' | 'discard' }
  | { t: 'toDiscard'; unitId: string; n: number } // 吞噬的牌整疊進棄牌區（消化）
  | { t: 'strike'; unitId: string; targetId: string }
  | { t: 'damage'; unitId: string; amount: number }
  | { t: 'heal'; unitId: string; amount: number }
  | { t: 'tp'; unitId: string; amount: number }
  | { t: 'counter'; unitId: string; id: string; delta: number }
  | { t: 'status'; unitId: string; text: string };
export type FxEvent = FxBody & { s: UnitSnap[] };

export interface GameState {
  seed: number;
  turn: number;            // 全局回合數（雙方合計）
  active: PlayerIdx;
  first: PlayerIdx;
  players: [PlayerState, PlayerState];
  prompt: Prompt | null;
  winner: PlayerIdx | 'draw' | null;
  log: LogEntry[];
  fx: FxEvent[];           // 最近一次操作產生的事件
  fxSeq: number;
  gameId: string;          // 每局不同，用來判斷是不是同一局
  endOfTurn: { kind: string; by: string }[];
  triggers: DeferTrigger[];   // 延後觸發佇列（目前的操作結算完就依序結算）
  uidCounter: number;
}

// ===== 玩家送出的操作 =====
export type Action =
  | { type: 'play'; unitId: string; cardUid: string }
  | { type: 'playUnder'; unitId: string; cardUid: string } // 使用壓在角色下方的牌
  | { type: 'attack'; unitId: string }
  | { type: 'advance'; unitId: string }
  | { type: 'rescue'; unitId: string }
  | { type: 'ability'; unitId: string; abilityId: string }
  | { type: 'endTurn' }
  | { type: 'answer'; value: Answer };
