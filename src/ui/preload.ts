// 預載：開場時把所有圖片載好、解碼完，再進大廳（之後畫面、動畫都不會閃）
import { CARD_DEFS, CHAR_DEFS } from '../engine';
import { ASSET_BASE, setResolvedAsset, stage } from './dom';

/** 會用到的所有圖（從角色、卡牌登記表自動列出，新角色不用改這裡） */
function allBases(): string[] {
  const list = [ASSET_BASE.lobby, ASSET_BASE.table, ASSET_BASE.back];
  for (const c of Object.values(CHAR_DEFS)) list.push(ASSET_BASE.char(c.id), ASSET_BASE.frame(c.id), ASSET_BASE.backOf(c.id));
  for (const d of Object.values(CARD_DEFS)) list.push(ASSET_BASE.card(d.id));
  return [...new Set(list)];
}

/** 留住載好的圖，避免被瀏覽器丟掉 */
const keep: HTMLImageElement[] = [];
const EXTS = ['webp', 'png'];
const TIMEOUT_MS = 20000;

function tryLoad(src: string): Promise<boolean> {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      keep.push(img);
      img.decode().catch(() => {}).finally(() => resolve(true));
    };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = src;
  });
}

async function resolveOne(base: string) {
  for (const ext of EXTS) {
    const src = `${base}.${ext}`;
    if (await tryLoad(src)) { setResolvedAsset(base, src); return; }
  }
  setResolvedAsset(base, null); // 沒有這張圖：畫面會用佔位圖
}

/** 顯示載入畫面並預載全部圖片 */
export async function preloadAssets(): Promise<void> {
  const bases = allBases();
  let done = 0;
  stage.innerHTML = `
    <div class="loading">
      <h1>Ethereal Arena</h1>
      <div class="bar"><div class="fill" id="load-fill"></div></div>
      <div class="txt" id="load-txt">載入圖片 0 / ${bases.length}</div>
    </div>`;
  const fill = document.getElementById('load-fill')!;
  const txt = document.getElementById('load-txt')!;
  await Promise.all(bases.map(b => resolveOne(b).then(() => {
    done++;
    fill.style.width = `${(done / bases.length) * 100}%`;
    txt.textContent = `載入圖片 ${done} / ${bases.length}`;
  })));
}
