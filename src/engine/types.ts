// ===== 遊戲狀態的資料結構（純資料，可以直接 JSON 傳給對手） =====

export type PlayerIdx = 0 | 1;

export interface CardInst {
  uid: string;   // 這張實體牌的唯一編號
  defId: string; // 對應的卡牌定義（隱藏時為 'hidden'）
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
  tpMaxDown: number;   // 永久的最大 TP 減少（[墜淵]）；等效最大 TP = tpMax - tpMaxDown
  spBonus: number;     // [居前] 加成

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
  | { kind: 'cards'; player: PlayerIdx; title: string; unitId: string; cardUids: string[]; min: number; max: number }
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
