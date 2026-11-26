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
  spBonus: number;     // [居前] 加成

  deck: CardInst[];
  hand: CardInst[];
  discard: CardInst[];
  playing: CardInst[]; // 正在結算中的牌

  // 回合內旗標
  attacked: boolean;
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

/** 給畫面做動畫用的事件 */
export type FxEvent =
  | { t: 'damage'; unitId: string; amount: number }
  | { t: 'heal'; unitId: string; amount: number }
  | { t: 'tp'; unitId: string; amount: number }
  | { t: 'status'; unitId: string; text: string }
  | { t: 'play'; unitId: string; defId: string }
  | { t: 'turn'; player: PlayerIdx };

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
  endOfTurn: { kind: string; by: string }[];
  uidCounter: number;
}

// ===== 玩家送出的操作 =====
export type Action =
  | { type: 'play'; unitId: string; cardUid: string }
  | { type: 'attack'; unitId: string }
  | { type: 'advance'; unitId: string }
  | { type: 'rescue'; unitId: string }
  | { type: 'ability'; unitId: string; abilityId: string }
  | { type: 'endTurn' }
  | { type: 'answer'; value: Answer };
