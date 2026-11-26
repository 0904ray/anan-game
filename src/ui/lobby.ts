// 大廳畫面
import { ASSET, esc, stage } from './dom';
import { ONLINE_OK, myName, setMyName, setSession, setView, me } from './state';
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
      <h1>冷倫卡牌對戰</h1>
      <div class="sub">暫定名稱 · ${VERSION}</div>
      <div class="panel">
        <label>你的名字 <input id="name" maxlength="12" value="${esc(myName)}"></label>
        <button class="btn" data-act="host" ${ONLINE_OK ? '' : 'disabled'}>建立房間</button>
        <div class="join-row"><input id="code" maxlength="6" inputmode="numeric" placeholder="輸入房號" ${ONLINE_OK ? '' : 'disabled'}><button class="btn" data-act="join" ${ONLINE_OK ? '' : 'disabled'}>加入</button></div>
        <button class="btn ghost" data-act="bot">對戰電腦（隨機出牌）</button>
        <button class="btn ghost" data-act="hotseat">本機雙人（同一台輪流）</button>
        ${ONLINE_OK ? '' : '<div class="note">這個預覽版不能連線對戰，請先玩「對戰電腦」或「本機雙人」</div>'}
      </div>
      ${roomCode ? `<div class="roomcode">${roomCode}</div>` : ''}
      <div class="status">${esc(status)}</div>
      ${roomCode ? `<button class="btn ghost small" data-act="lobby">取消</button>` : ''}
    </div>`;
}



export function readName() {
  const n = (stage.querySelector('#name') as HTMLInputElement | null)?.value.trim();
  if (n) { setMyName(n); try { localStorage.setItem('cg-name', n); } catch { } }
}
