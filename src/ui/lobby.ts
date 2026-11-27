// 大廳畫面
import { ASSET, esc, stage } from './dom';
import { ONLINE_OK, artHidden, installPrompt, myName, setMyName, setSession, setView, me, updateReady } from './state';
import { isInstalled, isIos } from './pwa';
import { VERSION } from '../config';

// =====================================================================
// 大廳
// =====================================================================
export function renderLobby(status = '', roomCode = '') {
  setSession(null);
  setView(null, me);
  stage.innerHTML = `
    <img class="bg-img" src="${ASSET.lobby}">
    <div class="lobby">
      <h1>Ethereal Arena</h1>
      <div class="sub">${VERSION}</div>
      <div class="panel">
        <label>你的名字 <input id="name" maxlength="12" value="${esc(myName)}"></label>
        <button class="btn" data-act="host" ${ONLINE_OK ? '' : 'disabled'}>建立房間</button>
        <div class="join-row"><input id="code" maxlength="6" inputmode="numeric" placeholder="輸入房號" ${ONLINE_OK ? '' : 'disabled'}><button class="btn" data-act="join" ${ONLINE_OK ? '' : 'disabled'}>加入</button></div>
        <button class="btn ghost" data-act="bot">對戰電腦（隨機出牌）</button>
        <button class="btn ghost" data-act="hotseat">本機雙人（同一台輪流）</button>
        ${ONLINE_OK ? '' : '<div class="note">這個預覽版不能連線對戰，請先玩「對戰電腦」或「本機雙人」</div>'}
      </div>
      ${roomCode ? `<div class="roomcode">${roomCode}</div><div class="roomhint">把房號傳給對手後，請回到這個畫面等候（切出去太久會斷線，回來會自動重連）</div>` : ''}
      <div class="status">${esc(status)}</div>
      ${roomCode ? `<button class="btn ghost small" data-act="lobby">取消</button>` : ''}
    </div>
    ${roomCode ? '' : `<button class="btn ghost small art-toggle" data-act="toggle-art">${artHidden ? '顯示 AI 圖' : '隱藏 AI 圖（改用色塊）'}</button>`}
    ${roomCode ? '' : pwaHtml()}
    ${roomCode ? '' : `<button class="btn ghost small settings-btn" data-act="settings">⚙ 設定</button>`}`;
}



/** PWA：有新版本的提示、安裝按鈕（只在正式網址出現，見 ui/pwa.ts） */
function pwaHtml(): string {
  let h = '';
  if (updateReady) h += `<button class="btn update-bar" data-act="pwa-update">有新版本（${esc(updateReady)}），點這裡更新</button>`;
  if (installPrompt) h += `<button class="btn ghost small install-btn" data-act="pwa-install">安裝到裝置</button>`;
  else if (isIos() && !isInstalled() && location.protocol === 'https:') h += `<div class="install-hint">iPhone／iPad：按 Safari 的「分享」→「加入主畫面」，就能像 App 一樣打開</div>`;
  return h;
}

export function readName() {
  const n = (stage.querySelector('#name') as HTMLInputElement | null)?.value.trim();
  if (n) { setMyName(n); try { localStorage.setItem('cg-name', n); } catch { } }
}
