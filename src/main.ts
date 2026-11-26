// 進入點：載入樣式、設定舞台、預載圖片，再決定一開始顯示什麼
import './styles/index.css';
import { setupStage } from './ui/dom';
import { preloadAssets } from './ui/preload';
import { renderLobby } from './ui/lobby';
import { startLocal } from './ui/input';

setupStage();

preloadAssets().then(() => {
  // 測試用：網址加 ?autostart=bot 或 ?autostart=hotseat 直接開始
  const auto = new URLSearchParams(location.search).get('autostart');
  if (auto === 'bot' || auto === 'hotseat') startLocal(auto);
  else renderLobby();
});
