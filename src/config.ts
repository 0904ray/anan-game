// 全域設定：改這裡就好，不用翻程式
/** 測試用網址 ?autostart= 直接開打時的隊伍（正常遊玩走選角畫面），左邊是 slot 0 */
export const DEFAULT_TEAMS: [[string, string], [string, string]] = [['savanna', 'granny'], ['savanna', 'granny']];
/** 同一隊可不可以選兩隻一樣的角色（雙方之間撞角色一律可以） */
export const ALLOW_SAME_CHAR_IN_TEAM = false;
/** PeerJS 房間 ID 前綴（房號會接在後面） */
export const PEER_ID_PREFIX = 'lenglun-card-';
/** 電腦每一步之間的延遲（毫秒） */
export const BOT_DELAY_MS = 650;
/** 版本字樣（大廳顯示） */
export const VERSION = '測試版 v0.13';
