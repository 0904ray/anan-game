# AGENTS.md — 給一起協作的 AI（以及人）看的說明

這是 **Ethereal Arena**（原名「冷倫卡牌對戰」，冷倫的網頁雙人卡牌對戰遊戲）。TypeScript + Vite，沒有框架。
動手前先讀完這份文件；有規則不清楚的地方，**問專案擁有者，不要自己猜了就寫死**。

## 語言

- 介面文字、註解、commit 訊息、文件：**繁體中文（台灣用語）**。
- 程式識別字（變數、函式、檔名）：英文。
- 遊戲術語照卡面寫法：AP、TP、HP、AT、SP、[打擊]、[負傷]、[重創]、[瀕死]、[處決]、[收買X]、[暴食]、[吞噬]……

## 指令

```bash
npm install
npm run dev        # 開發伺服器 http://localhost:5173（?autostart=bot 或 ?autostart=hotseat 直接開打）
npm test           # 規則測試＋隨機對打壓力測試（vitest）
npx tsc            # 型別檢查（tsconfig 有開 noUnusedLocals / noUnusedParameters）
npm run build      # 打包成單一檔案到 docs/（docs/ 是產出物，有進 git，方便直接雙擊或放上網站）
```

**每次提交前三個都要過：`npx tsc`、`npm test`、`npm run build`。**

## 架構：三層，依賴只能往下

```
ui/   畫面（DOM、動畫、輸入）          ──┐
net/  連線（本機、電腦、PeerJS 端對端） ──┼──▶ engine/  遊戲規則（純邏輯）
config.ts 全域設定                     ──┘
```

- `engine/` **不可以** import `ui/`、`net/`，也不可以碰 DOM、`window`、`Math.random`、`Date`（`gameId` 例外）。
- `ui/` 和 `net/` 只從 `engine/index.ts` import，不直接 import `engine/game.ts` 等內部檔案。
- 規則只在 engine 裡判斷。畫面要知道「能不能做」時，用 `liveGame().checkAction()` / `legalActions()` 問引擎，不要在畫面重寫規則。

```
src/
  main.ts                進入點
  config.ts              測試用預設隊伍、同隊能否重複角色、PeerJS 前綴、電腦延遲、版本字樣
  engine/
    index.ts             對外入口（只 export 需要的東西）
    types.ts             所有資料型別（GameState 必須能 JSON 序列化）
    defs.ts              角色／卡牌定義格式、登記表、回合結束效果登記表
    game.ts              核心規則：回合、AP、TP、負傷/重創/瀕死/處決、SP、居前、救治、傷害、事件
    view.ts              viewFor：產生給某位玩家看的資料（藏手牌、藏牌組順序）
    roster.ts            角色名單、隊伍驗證（isValidTeam）、電腦隨機組隊
    bot.ts               合法操作列表、隨機電腦
    chars/index.ts       ★ 新角色在這裡 import 登記
    chars/<角色>.ts      每個角色一個檔：能力＋牌組
  net/session.ts         Session 介面：LocalSession（本機/電腦）、HostSession、GuestSession
  ui/
    state.ts             畫面狀態（只在這裡宣告；其他模組讀取，寫入一律用 setXxx）
    dom.ts               舞台、圖片路徑、esc()、toast
    render.ts            狀態 → HTML（純函式，不處理輸入、不播動畫）
    anim.ts              動畫佇列：依引擎事件順序播放
    popups.ts            頁內彈出視窗
    lobby.ts             大廳
    select.ts            選角畫面（自動列出 roster() 的所有角色）
    input.ts             所有輸入事件、建立 Session
  styles/                依區塊分檔：base / lobby / select / board / cards / face（卡面卡背）/ overlay / anim / tone（色調）
test/
  helpers.ts             newGame / answer / give / simulate
  core.test.ts           核心規則
  <角色>.test.ts         每個角色一個檔
  simulation.test.ts     隨機對打壓力測試
```

## 引擎的關鍵觀念

1. **狀態是純資料**：`GameState` 要能 `JSON.stringify` 後傳給對手。不要在裡面放函式、class、Map。
2. **效果是 generator**：卡牌和能力的 `play` / `use` / `onDiscard` 是 `function*`。
   需要玩家選擇時 `yield` 一個 `Prompt`（用 `g.chooseEnemy`、`g.chooseAlly`、`g.chooseUnit`、`g.chooseHandCards`、`g.confirm`、`g.option`），拿到答案再繼續。
3. **亂數只用 `g.rand()` / `g.shuffle()`**，同一個種子要能重現同一局。
4. **畫面看得到的變化都要發事件**：抽牌、棄牌、傷害等核心函式已經會發。
   如果新機制讓牌或數值用新的方式移動，呼叫 `g.fx({...})`，並在 `ui/anim.ts` 的 `playEvent` 加對應動畫。每個事件都會自動帶當下的數值快照。
5. **角色專屬的東西不進核心**：
   - 角色計數器（財富、暴食）→ `CharDef.counters` ＋ `g.counter()` / `g.addCounter()`
   - 被動觸發 → `CharDef.hooks`（`onAllyDiscard`、`onTurnStartBeforeDraw`、`atBonus`、`onStrike`、`afterPlayUnder`）
   - 「本回合結束時」→ 卡牌 `g.state.endOfTurn.push({ kind, by })`，角色檔裡 `registerEndOfTurn(kind, fn)`
   - 會變動的費用 → `CardDef.costFor`；角色下方的牌堆 → `Unit.under` ＋ `CharDef.underName` / `canPlayUnder`
   - **真的需要新的觸發時機**，在 `defs.ts` 的 hooks 加一個**通用**的 hook，在 `game.ts` 適當位置呼叫。不要在 `game.ts` 寫 `if (charId === 'xxx')`。
6. **規則常數**（SP 指定、負傷門檻、瀕死每 4 傷 -1 TP…）都在 `game.ts`，改規則改這裡，並更新測試。

## 新增角色（清單）

1. 複製 `src/engine/chars/granny.ts`（機制較完整）或 `savanna.ts`，改成新角色。卡牌 `id` 用 `角色前綴_英文`，例如 `gra_bone`。
2. 在 `src/engine/chars/index.ts` 加一行 import。
3. 寫 `test/<角色>.test.ts`：每個能力、每張牌至少一個測試；用 `test/helpers.ts` 的工具。
4. 在 `test/simulation.test.ts` 加一組含新角色的隊伍跑隨機對打。
5. 規則有不明確、自己做了決定的地方，寫進 `README.md` 的「規則實作備註」，並回報給專案擁有者確認。
6. 在 `CharDef` 設 `theme`（角色主題色，CSS 顏色字串），卡面細框、名稱條、牌堆外框會用到。
7. **圖片提示詞不用寫**：`圖片提示詞.md` 由專案管理（Claude，負責架構與程式管理的那位）統一撰寫，風格和規格才會一致。
   新角色的 PR 說明裡請附一段「**外觀設定**」，提供：外型、**武器**、代表色、個性氣質，以及每張卡想呈現的畫面重點（一兩句就好）。
   圖片檔名規格照舊：立繪 `assets/chars/<角色id>.png`、卡圖 `assets/cards/<卡牌id>.png`、卡面底框 `assets/frames/<角色id>.png`、卡背 `assets/backs/<角色id>.png`。
8. 登記後選角畫面會**自動出現**新角色，不用改任何畫面程式。還沒做完、不想讓玩家選到的角色，在 `CharDef` 設 `hidden: true`。
9. 想直接測新角色：改 `src/config.ts` 的 `DEFAULT_TEAMS`，然後開 `?autostart=bot`。

## 畫面慣例

- 固定 16:9 舞台，座標以 **1920×1080** 為準（`#stage` 會等比縮放）。版面座標寫在 `styles/board.css` 開頭的註解。
- 任何會進 `innerHTML` 的文字都要過 `esc()`，尤其是玩家名字（來自網路）。
- 點擊用 `data-*` 屬性，由 `ui/input.ts` 統一處理；render 函式不綁事件。
- 圖片放在 `public/assets/`；沒有圖時畫面會自動顯示佔位色塊，不要因為缺圖而報錯。
- 卡面一律用 `render.ts` 的 `cardInner()`、卡背一律用 `backHtml()`，不要自己拼卡片 HTML。卡面文字永遠由遊戲畫在角色底框**上面**（深色半透明文字框），所以底框圖只負責外觀、不能放文字。
- 動畫播放時 `ui/anim.ts` 的 `isBusy()` 為 true，輸入會被擋下（點擊＝加速）。
- 色調層次統一在 `styles/tone.css`：只有能操作、正在發生的東西是全彩，其他圖退到背景。畫面太刺眼或太暗時只調那裡的變數，不要在別的地方另外加濾鏡。

## 連線

- PeerJS 端對端：**房主的瀏覽器跑規則**（權威），客人只送 `Action`，房主用 `viewFor` 把各自能看的畫面送回去。
- 流程：連上 → 雙方各自選角（`onNeedTeam` → `submitTeam`，看不到對方選誰）→ 兩邊都確認才開局 → 結束後可「再來一局」（同隊伍）或「重新選角」（`reselect`）。
- 本機模式（電腦、雙人同螢幕）是畫面先選角，再用選好的隊伍建立 `LocalSession`。
- 對方送來的任何東西都當不可信：`Game.apply` 會驗證所有操作。
- 測試連線可以自架 PeerJS 伺服器，網址加 `?peerHost=127.0.0.1&peerPort=9000&peerPath=/`。

## 不要做的事

- 不要在 engine 用 `Math.random`、DOM、`setTimeout`。
- 不要為了單一角色修改核心流程（見上面第 5 點）。
- 不要在畫面重寫規則判斷。
- 不要隨便加套件；要加先說明原因。
- 不要刪掉或改寫專案擁有者已確認的規則決定（README「規則實作備註」），要改先問。

## 待辦

看 `TODO.md`。做完一項就勾起來。
