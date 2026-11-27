# AGENTS.md — 給一起協作的 AI（以及人）看的說明

這是 **Ethereal Arena**（原名「冷倫卡牌對戰」，冷倫的網頁雙人卡牌對戰遊戲）。TypeScript + Vite，沒有框架。
動手前先讀完這份文件；有規則不清楚的地方，**問專案擁有者，不要自己猜了就寫死**。

## 語言

- 介面文字、註解、commit 訊息、文件：**繁體中文（台灣用語）**。
- 程式識別字（變數、函式、檔名）：英文。
- 遊戲術語照卡面寫法：AP、TP、HP、AT、SP、[打擊]、[負傷]、[重創]、[瀕死]、[處決]、[收買X]、[暴食]、[吞噬]……
- 會消耗資源的條件，卡面寫成「花費[收買X] 效果」；只是判斷、不消耗東西的條件寫成「當[連擊 X] 效果」。

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
    keywords.ts          詞條表：[打擊]、[瀕死]… 的說明和顏色分類（純資料）
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
    render.ts            狀態 → HTML（純函式，不處理輸入、不播動畫）；cardInner 卡面、richText 詞條上色
    anim.ts              動畫佇列：依引擎事件順序播放
    popups.ts            頁內彈出視窗
    lobby.ts             大廳
    select.ts            選角畫面（自動列出 roster() 的所有角色）
    input.ts             所有輸入事件、建立 Session
    preload.ts           開場預載所有圖片（從角色、卡牌登記表自動列出）
    zoom.ts              長按／右鍵放大卡牌
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
   要從我方好幾副手牌選牌時，用 `g.chooseCardsFrom([單位…], …)`：能選的牌一起高亮、可以混著選，**不要先問「選誰的手牌」**（專案擁有者的要求）；選完用 `g.cardOwner(uid)` 找牌是誰的。
3. **亂數只用 `g.rand()` / `g.shuffle()`**，同一個種子要能重現同一局。
4. **畫面看得到的變化都要發事件**：抽牌、棄牌、傷害等核心函式已經會發。
   如果新機制讓牌或數值用新的方式移動，呼叫 `g.fx({...})`，並在 `ui/anim.ts` 的 `playEvent` 加對應動畫。每個事件都會自動帶當下的數值快照。
5. **角色專屬的東西不進核心**：
   - 角色計數器（財富、暴食）→ `CharDef.counters` ＋ `g.counter()` / `g.addCounter()`
   - 被動觸發 → `CharDef.hooks`（`onAllyDiscard`、`onAllyShuffle`、`onUnitCritical`、`onTurnStartBeforeDraw`、`onOwnTurnEnd`、`atBonus`、`onStrike`、`afterPlayUnder`…完整清單看 `defs.ts`）
   - 改變能指定的敵人（例如不受 SP 限制）→ `hooks.enemyTargets`
   - SP 加減 → `hooks.spDelta`；我方回復 HP 時 → `hooks.onAllyHeal`；[救治]不限次數 → `CharDef.rescueUnlimited`；不能普攻 → `CharDef.noAttack`；改寫[救治]花費 → `CharDef.rescueCost`；[不屈] → `CharDef.unyielding`（能不能行動一律問 `g.canAct()`）；損失 HP → `hooks.onHpLoss`；任一單位進入[負傷] → `hooks.onUnitWounded`；打擊自身 → `g.strikeSelf()`＋`hooks.selfHit`；回復 TP → `g.gainTp()`；支付 HP 代價 → `g.payHp()`；手牌當費用 → `CharDef.costAs: 'hand'`；自訂整個主動攻擊 → `hooks.attack`；起手抽牌張數 → `hooks.turnStartDraw`、取代隊友起手抽牌 → `hooks.onAllyStartDraw`；檢索 → `g.searchDeck()`／`g.searchDiscard()`；HP／TP 綁定 → `Unit.hpLink`／`tpLink`；本回合停止行動 → `Unit.noActionTurn`；效果造成的救治（回歸）→ `g.reviveUnit()`；「直接打出」手牌（強制打出）→ `g.playFromHand()`（和一般出牌同一個流程，含付費）；回合開始需要玩家選擇 → `hooks.onTurnStartBeforeDraw` 可以寫成 generator
   - 掛在單位身上、要顯示徽章的狀態（例如[墬淵]、[聖環]）→ `registerStatus()`＋`g.addCounter()`；狀態自己的效果（治療加成、持有者回合開始／結束時、受到攻擊時的增傷）寫在 `StatusDef` 裡，持有者死掉的角色也照樣結算
   - 角色受到傷害／扣 TP／要被[處決]時的修正 → 通用 hook `incomingDamage`（受到傷害前改傷害）、`dyingTpLoss`（[瀕死]時受到**攻擊**扣 TP 前改量；付費、-X TP 的效果不會經過它）、`canBeExecuted`（擋 `g.executeUnit`）、`extraWounded`（[負傷]的其他條件）
   - 進入[瀕死]、HP 歸零這種**同步**時機要玩家選擇 → `hooks.onEnterDying` ＋ `g.queueTrigger({ kind, by })`、角色檔 `registerTrigger(kind, function* …)`：排到目前這個操作（出牌、攻擊、能力、反擊）結算完才依序結算，Prompt 的玩家是觸發者的擁有者（可能不是目前回合的玩家）
   - 效果要讓單位直接進入[瀕死] → `g.enterDying()`；TP 沒有上限 → `CharDef.tpUncapped`
   - 卡牌能不能打出的額外條件 → `CardDef.canPlay`（回傳字串＝不能打的理由）
   - [反擊]這類「被指定為攻擊目標時才能打出」的牌 → `CardDef.reaction` ＋ `react(g, u, ctx)`；單體指定攻擊目標之後要 `yield* g.declareAttackTarget(攻擊者, 目標)`（範圍攻擊不用），取消時核心會丟 `ActionCanceled` 中止這個操作
   - 「(抽出時)」效果 → 卡牌 `drawText`（卡面文字）＋`onDrawCard`（結算）；寫法比照 `discardText`／`onDiscard`
   - 牌的去向：`g.mill()`（牌組→棄牌區）、`g.removeHandCards()`／`g.removeDeckTop()`／`removeAfterPlay`（移出牌局）、`g.abilityShuffle()`（[洗牌]）
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
   圖片放進來後如果畫風比別的角色淡或暗（在牌桌上發灰），在 `CharDef` 設 `artTone`（CSS filter，例如米雅的 `'contrast(1.28) saturate(1.45) brightness(1.04)'`），會疊在牌桌的色調層次上，不要另外寫 CSS。
   角色專屬的詞（像財富、暴食、焰能）寫進 `CharDef.keywords`（`{ 詞: '說明' }`），卡面上會自動上色、加底線，長按放大時可以看說明。共用的詞在 `engine/keywords.ts`，要新增先問專案擁有者怎麼定義。
7. **圖片提示詞不用寫**：`圖片提示詞.md` 由專案管理（Claude，負責架構與程式管理的那位）統一撰寫，風格和規格才會一致。
   新角色的 PR 說明裡請附一段「**外觀設定**」，提供：外型、**武器**、代表色、個性氣質，以及每張卡想呈現的畫面重點（一兩句就好）。
   圖片檔名規格：立繪 `assets/chars/<角色id>`、卡圖 `assets/cards/<卡牌id>`、卡背 `assets/backs/<角色id>`（.webp）。卡面不用底框圖，外框用 `theme` 主題色。
   會變身的角色可以有型態立繪：`CharDef.forms`（`{ id, name, counter }`，計數器 > 0 時頭像換成 `assets/chars/<角色id>_<型態id>`，沒圖就用一般立繪），例如異端物的異方侵入／超越此方。
8. 登記後選角畫面會**自動出現**新角色，不用改任何畫面程式。還沒做完、不想讓玩家選到的角色，在 `CharDef` 設 `hidden: true`。
9. 想直接測新角色：開 `?autostart=bot&teams=<我方角色1>,<我方角色2>;<對方角色1>,<對方角色2>`（例如 `?autostart=bot&teams=ranis,savanna;saviel,granny`），或改 `src/config.ts` 的 `DEFAULT_TEAMS`。

## 畫面慣例

- 固定 16:9 舞台，座標以 **1920×1080** 為準（`#stage` 會等比縮放）。版面座標寫在 `styles/board.css` 開頭的註解。
- 任何會進 `innerHTML` 的文字都要過 `esc()`，尤其是玩家名字（來自網路）。
- 點擊用 `data-*` 屬性，由 `ui/input.ts` 統一處理；render 函式不綁事件。
- 圖片放在 `public/assets/`，格式是 **WebP**（`.png` 也讀得到，但會比較慢）。路徑在 `ui/dom.ts` 的 `ASSET` 一律不寫副檔名，開場時 `ui/preload.ts` 會把所有圖載好、決定實際檔案。沒有圖時畫面會自動顯示佔位色塊，不要因為缺圖而報錯。玩家可以在大廳按「隱藏 AI 圖」把所有圖換成色塊（`state.ts` 的 `artHidden`，`ui/dom.ts` 的圖片網址會一律回傳找不到），新的圖片一律走 `ASSET`，這個開關才會生效。
- 新圖片由專案管理（Claude）處理：用 `python scripts/optimize_images.py` 把生圖 AI 的 PNG 縮成實際需要的大小再轉 WebP（卡圖 768×512、立繪 640×960、卡背 512×768）。不要把原尺寸 PNG 直接放進 `public/assets/`。
- 卡面一律用 `render.ts` 的 `cardInner()`、卡背一律用 `backHtml()`，不要自己拼卡片 HTML。卡面整張由遊戲畫（卡圖＋名稱條＋文字框，外框用角色主題色），沒有底框圖。
- 卡牌、能力文字裡的特殊詞條用 `[詞]` 包起來（例如 `[打擊]`、`[收買2]`），畫面會用 `richText()` 自動上色、有說明的加底線；和詞條同名但沒加括號的詞也認得。顏色分類和說明都在 `engine/keywords.ts`（共用）和 `CharDef.keywords`（角色專屬）；卡名用 `【】`。新角色的新詞不用改畫面程式。
- 任何卡面（`cardInner()` 產生的）都可以長按／右鍵放大（`ui/zoom.ts`，看 `data-zoom`），左側列出卡上詞條的說明，指著或點詞條會亮起對應說明。其他地方想讓卡能放大，加 `data-zoom="<卡牌id>"` 就好。
- 動畫播放時 `ui/anim.ts` 的 `isBusy()` 為 true，輸入會被擋下（點擊＝加速）。
- 色調層次統一在 `styles/tone.css`：只有能操作、正在發生的東西是全彩，其他圖退到背景。畫面太刺眼或太暗時只調那裡的變數，不要在別的地方另外加濾鏡；單一角色的畫風校正用 `CharDef.artTone`。

## 音樂與音效

- 音檔放 `public/audio/`（mp3，手機都能播）：`bgm.mp3` 循環播放的背景音樂；`card.mp3` 出牌、抽牌、洗牌、棄牌；`hit.mp3` 攻擊命中。
- 播放程式在 `ui/audio.ts`：`playSfx('card' | 'hit')`。音效掛在 `ui/anim.ts` 的 `playEvent`，新機制有新的動畫時順便決定要不要出聲。新增音效：檔案放進 `public/audio/`、在 `SFX_FILES` 登記。
- 音量：`state.ts` 的 `musicVol`／`sfxVol`（會記住），大廳右上角和對戰中（結束回合按鈕下方）的「⚙ 設定」都能調。音量一律走 Web Audio 的 GainNode（iPhone 不能改 `<audio>.volume`）。
- 瀏覽器規定玩家點過畫面才能出聲，所以第一次點擊才開始播；切到背景時音樂會暫停。
- 新音檔由專案管理（Claude）處理：剪掉 BGM 頭尾靜音（循環才不會斷）、轉成 mp3（BGM 128k 立體聲，音效 96k 單聲道）。

## 裝成 App（PWA）

- 放上 https 網址（GitHub Pages：`main` 分支的 `/docs`）後，手機和電腦都能「安裝」，裝好是橫向全螢幕、離線可玩（對電腦、本機雙人）。
- `public/manifest.webmanifest`：App 名稱、圖示（`public/icons/`）、橫向全螢幕。`public/sw.js`：離線快取（遊戲本體和圖片先用快取）。
- **檢查更新**：`npm run build` 會把 `src/`、`public/`、`index.html` 的內容算成一個建置編號，寫進程式（`__BUILD_ID__`）和 `docs/version.json`。玩家打開遊戲時 `ui/pwa.ts` 會去讀網站上的 `version.json`，編號不一樣就在大廳顯示「有新版本」，按下去清掉快取、換成新版。所以**改完推上 main（含 docs/）就是發布新版**，不用手動改編號；大廳顯示的版本字樣還是看 `config.ts` 的 `VERSION`，發布重要更新時記得一起改。
- 開發伺服器、直接雙擊 `index.html`、嵌在預覽框裡都不會啟用（`ui/pwa.ts` 的 `enabled()`）。要在本機測，用 `npm run build` 後 `npx vite preview` 開 `http://localhost:4173`。

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
