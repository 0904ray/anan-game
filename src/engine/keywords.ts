// 詞條表：卡牌、能力文字裡 [詞] 的說明（純資料）。
// 長按放大卡牌時，點／指著詞條會在左側顯示這裡的說明。
//   共用詞條寫在這裡；角色專屬的詞（財富、暴食、焰能…）寫在角色檔的 CharDef.keywords。
//   說明文字裡也可以用 [詞]，畫面會一樣上色、可以再點開。
// 說明結尾寫「（尚未實作）」的是專案擁有者先定義好、還沒有角色用到的機制（會變成 wip: true）。
import { CHAR_DEFS } from './defs';

/** 詞條分類：決定顏色。atk 攻擊類、sta 狀態類、sys 一般規則、chr 角色專屬（用角色主題色） */
export type KeywordCat = 'atk' | 'sta' | 'sys' | 'chr';
export interface KeywordDef {
  name: string; cat: KeywordCat; text: string;
  /** 專案擁有者先定義好、還沒有角色用到的機制（說明會標「尚未實作」，文字裡沒加中括號的同名詞不會被當成詞條） */
  wip?: boolean;
}

export const KEYWORDS: Record<string, KeywordDef> = {};
function kw(name: string, cat: KeywordCat, text: string) {
  const wip = text.endsWith('（尚未實作）');
  KEYWORDS[name] = { name, cat, text: wip ? text.slice(0, -'（尚未實作）'.length) : text, ...(wip ? { wip } : {}) };
}

// ---------- 攻擊 ----------
kw('打擊', 'atk', '對 1 名單位造成等同自身 AT 的傷害，並使對方 -1 TP。對[負傷]單位傷害 +1。');
kw('直擊', 'atk', '和[打擊]一樣造成傷害，但不會減少對方 TP（所以不會打出[負傷]、[重創]）。對[瀕死]單位仍會照常扣 TP。');
kw('直傷', 'atk', '造成固定傷害，不受[直傷]敘述以外的效果影響（例如[負傷]的增傷、受到傷害減少），且不會減少對方 TP。');
kw('主動攻擊', 'atk', '角色的普攻：花 AP 對 1 名敵方單位[打擊] 1 次，每回合 1 次。花多少 AP 看角色的「AT × AP」。');
kw('打擊自身', 'atk', '對自己[打擊]：受到等同自身 AT 的傷害，並 -1 TP（會讓自己進入[負傷]、[重創]）。有些角色的能力會改變自傷的傷害。');
kw('速攻', 'atk', '此單位每回合第 1 次[主動攻擊]不消耗 AP；如果是[額外單位]，召喚當下就可以行動。（尚未實作）');

// ---------- 狀態 ----------
kw('負傷', 'sta', 'TP 剩一半以下（無條件捨去）時陷入。受到攻擊時傷害 +1。');
kw('重創', 'sta', 'TP 歸零時陷入，立刻受到 3 點[直傷]，並失去[居前]的 SP 加成。');
kw('瀕死', 'sta', 'HP 歸零時進入，TP 回滿。不能行動、不能抽牌；受到攻擊改成扣 TP（每次 1，傷害每滿 4 點再多扣 1），TP 扣光就被[處決]。隊友可以[救治]。');
kw('處決', 'sta', '[瀕死]單位的 TP 歸零時被處決，[死亡]並逐出本牌局。');
kw('死亡', 'sta', '單位離開本牌局，不能再行動，也不能被指定。');
kw('救治', 'sta', '隊友[瀕死]時，花 HP＋AP 共「隊友 TP × 2」把他救回來（自己 HP 至少留 1）。被救的隊友以等量的 HP 回歸，當回合不能行動。一局只能用一次。');
kw('居前', 'sta', '花 1 AP，SP +1，直到自己下個回合開始。敵方只能指定 SP 最高的單位，所以可以用來擋在隊友前面。');
kw('即死', 'sta', 'HP 歸零時直接[死亡]（不會進入[瀕死]）。（尚未實作）');
kw('不屈', 'sta', '此單位[瀕死]時依然可以行動，但 SP 不會變化。');
kw('不滅', 'sta', '被[處決]時，自身[復活]，並得到[即死]；如果是[額外單位]，則以 1 HP [復活]。（[復活]後移除此狀態）（尚未實作）');
kw('復活', 'sta', '以和 TP 相同的 HP 回歸牌局。（尚未實作）');
kw('離場', 'sta', '自身 SP 低於我方所有單位，且不能被指定為目標，自身也不能使用任何主動行動。（自身回合開始時解除）（尚未實作）');

// ---------- 一般規則 ----------
kw('棄置時', 'sys', '這張牌被「棄置」（不是打出）時，會發動後面的效果。');
kw('臨時HP', 'sys', '額外的 HP：受到傷害時先扣臨時 HP，扣完才扣本來的 HP。自己的回合開始時清空。');
kw('臨時TP', 'sys', '額外的 TP：減少 TP 時先扣臨時 TP，扣完才扣本來的 TP。自己的回合開始時清空。');
kw('抽出時', 'sys', '這張牌被抽到手上的當下（包含開局抽牌），會發動後面的效果。');
kw('移除', 'sys', '把牌直接放進棄牌區。「從牌組移除 N 張」＝牌組最上方的 N 張（牌組不夠就只移除剩下的）；手牌被移除也一樣進棄牌區。不算抽牌、不算棄牌，不會觸發棄牌相關的效果。');
kw('移出牌局', 'sys', '這張牌離開本場遊戲：不會進棄牌區，也不會再洗回牌組。雙方都只看得到張數。');
kw('洗牌', 'sys', '以能力洗牌：把棄牌區洗回牌組，然後抽 1 張牌。（牌組抽完時自動把棄牌區洗回去不算[洗牌]，也不會多抽）');
kw('額外單位', 'sys', '召喚出來的單位，一名[玩家單位]最多 4 隻。召喚的當回合不能行動，AP 花費由召喚者負擔。HP 歸零直接[死亡]（有[不屈]的單位改以 1 HP 進入[瀕死]）。（尚未實作）');
kw('玩家單位', 'sys', '開局時選進隊伍的角色（相對於召喚出來的[額外單位]）。');

/**
 * 找詞條說明：先找共用詞條，再找各角色的專屬詞。
 * 「收買2」「連擊 3、4、5」「收買X」這種帶數字的詞，會去掉後面的數字再找。
 */
export function keywordBase(word: string): string {
  return word.trim().replace(/^[（(]|[）)]$/gu, '').replace(/[\s\dXx、,，]+$/u, '').trim();
}
export function findKeyword(word: string): (KeywordDef & { charId?: string }) | null {
  const base = keywordBase(word);
  if (KEYWORDS[base]) return KEYWORDS[base];
  for (const c of Object.values(CHAR_DEFS)) {
    const t = c.keywords?.[base];
    if (t) return { name: base, cat: 'chr', text: t, charId: c.id };
  }
  return null;
}

/** 可以不加中括號也認得的詞條名稱（共用＋角色專屬，不含 wip），長的排前面：畫面用來在文字裡找「沒加中括號」的詞 */
export function keywordNames(): string[] {
  const names = new Set(Object.values(KEYWORDS).filter(k => !k.wip).map(k => k.name));
  for (const c of Object.values(CHAR_DEFS)) for (const k of Object.keys(c.keywords ?? {})) names.add(k);
  return [...names].sort((a, b) => b.length - a.length);
}
