// 畫面狀態：只在這裡宣告，其他模組讀取（live binding），寫入一律透過 set 函式
import { Game, type GameState, type PlayerIdx } from '../engine';
import type { Session } from '../net/session';

export let session: Session | null = null;
export let view: GameState | null = null;
/** 我是哪一方（畫面下方） */
export let me: PlayerIdx = 0;
export let lastFxSeq = -1;
/** 出牌展示區目前顯示的牌 */
export let lastPlayed: { defId: string; by: string; side: PlayerIdx } | null = null;
/** 滑鼠移到手牌上時暫時預覽的牌（電腦用） */
export let hoverDef: string | null = null;
export let myName = '玩家';
try { myName = localStorage.getItem('cg-name') || '玩家'; } catch { /* 預覽環境可能不能用 localStorage */ }
/** 隱藏所有 AI 圖（立繪、卡圖、卡背、背景），改顯示佔位色塊；大廳的按鈕切換，會記住 */
export let artHidden = false;
try { artHidden = localStorage.getItem('cg-hide-art') === '1'; } catch { /* 同上 */ }

/** 只屬於這個畫面的操作狀態 */
export const ui = {
  selected: new Set<string>(),   // 選牌視窗中已選的牌
  picked: null as { unitId: string; uid: string } | null, // 準備打出的牌
  numberVal: 0,
};

/** 嵌在 Claude 預覽框裡時不能用 WebRTC，所以關掉連線功能 */
export const ONLINE_OK = (() => { try { if (window.self !== window.top) return false; new RTCPeerConnection().close(); return true; } catch { return false; } })();

export function setSession(s: Session | null) { session?.close(); session = s; }
export function setView(v: GameState | null, m: PlayerIdx) { view = v; me = m; }
export function setLastFxSeq(n: number) { lastFxSeq = n; }
export function setLastPlayed(x: typeof lastPlayed) { lastPlayed = x; }
export function setHoverDef(x: string | null) { hoverDef = x; }
export function setMyName(n: string) { myName = n; }

export function rel(p: PlayerIdx) { return p === me ? 'me' : 'op'; }
/** 用目前畫面的資料建一個 Game，拿來判斷操作是否合法、算數值 */
export function liveGame(): Game { return new Game(view!); }
export function setArtHidden(v: boolean) { artHidden = v; try { localStorage.setItem('cg-hide-art', v ? '1' : '0'); } catch { /* 同上 */ } }
