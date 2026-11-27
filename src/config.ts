// 全域設定：改這裡就好，不用翻程式
/** 測試用網址 ?autostart= 直接開打時的隊伍（正常遊玩走選角畫面），左邊是 slot 0 */
export const DEFAULT_TEAMS: [[string, string], [string, string]] = [['savanna', 'granny'], ['savanna', 'granny']];
/** 同一隊可不可以選兩隻一樣的角色（雙方之間撞角色一律可以） */
export const ALLOW_SAME_CHAR_IN_TEAM = false;
/** PeerJS 房間 ID 前綴（房號會接在後面） */
export const PEER_ID_PREFIX = 'lenglun-card-';
/**
 * 中繼（TURN）伺服器的憑證網址：兩支手機不能直接連線時用（部分行動網路、學校／公司 Wi‑Fi）。
 * 到 metered.ca 申請免費的 Open Relay（每月 20 GB，卡牌遊戲一局只用幾十 KB），
 * 貼上儀表板給的網址，形如 https://<你的應用名稱>.metered.live/api/v1/turn/credentials?apiKey=<金鑰>。
 * 空字串＝只用 PeerJS 內建的（歐美伺服器，台灣用起來不穩）。
 */
export const TURN_CREDENTIALS_URL = '';
/** 電腦每一步之間的延遲（毫秒） */
export const BOT_DELAY_MS = 650;
/** 版本字樣（大廳顯示） */
export const VERSION = '測試版 v0.13';
