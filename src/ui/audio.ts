// 音樂與音效
// - BGM：public/audio/bgm.mp3，循環播放（音量看 state.ts 的 musicVol）
// - 音效：card（出牌、抽牌、洗牌、棄牌）、hit（攻擊命中），音量看 sfxVol
// - 瀏覽器規定要玩家先點一下畫面才能出聲：第一次點擊／按鍵時才建立 AudioContext、開始播 BGM
// - 音量一律透過 GainNode 調（iPhone 的 <audio>.volume 不能改）
// - 音檔用 fetch 讀（會進 PWA 的離線快取），BGM 轉成 blob 網址再給 <audio>，離線也能播
import { musicVol, sfxVol } from './state';

export type Sfx = 'card' | 'hit';
const SFX_FILES: Record<Sfx, string> = { card: 'audio/card.mp3', hit: 'audio/hit.mp3' };
const BGM_FILE = 'audio/bgm.mp3';

let ctx: AudioContext | null = null;
let musicGain: GainNode | null = null;
let sfxGain: GainNode | null = null;
let bgm: HTMLAudioElement | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
/** 同一種音效太密集時（例如一次抽 5 張）只播一部分，避免疊成噪音 */
const lastPlayed = new Map<Sfx, number>();

/** 進入點：等玩家第一次點擊或按鍵 */
export function setupAudio() {
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    start();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  // 切到背景（手機回桌面、切分頁）時暫停音樂，回來再繼續
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { bgm?.pause(); ctx.suspend().catch(() => {}); }
    else { ctx.resume().catch(() => {}); syncMusic(); }
  });
}

function start() {
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = new AC() as AudioContext;
    musicGain = ctx.createGain();
    sfxGain = ctx.createGain();
    musicGain.connect(ctx.destination);
    sfxGain.connect(ctx.destination);
    applyVolumes();
    for (const [name, file] of Object.entries(SFX_FILES) as [Sfx, string][]) {
      fetch(file).then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then(b => ctx!.decodeAudioData(b))
        .then(buf => buffers.set(name, buf))
        .catch(() => { /* 沒有檔案就安靜 */ });
    }
    // BGM：<audio> 在點擊當下建立並呼叫 play()（iPhone 需要），檔案讀好再接上
    bgm = new Audio();
    bgm.loop = true;
    ctx.createMediaElementSource(bgm).connect(musicGain);
    fetch(BGM_FILE).then(r => (r.ok ? r.blob() : Promise.reject()))
      .then(b => { bgm!.src = URL.createObjectURL(b); syncMusic(); })
      .catch(() => { /* 沒有檔案就安靜 */ });
  } catch { ctx = null; }
}

/** 套用目前的音量設定（設定視窗拖動滑桿時呼叫） */
export function applyVolumes() {
  if (!ctx || !musicGain || !sfxGain) return;
  const t = ctx.currentTime;
  // 滑桿是線性的，耳朵是對數的：平方一下，拉到一半聽起來才像「一半」
  musicGain.gain.setTargetAtTime(musicVol * musicVol, t, 0.03);
  sfxGain.gain.setTargetAtTime(sfxVol * sfxVol, t, 0.03);
  syncMusic();
}

/** 音樂音量 0 就停掉（省電），否則確保在播 */
function syncMusic() {
  if (!bgm || !bgm.src || document.hidden) return;
  if (musicVol <= 0) bgm.pause();
  else if (bgm.paused) bgm.play().catch(() => { /* 還不能播（沒有點擊過）：之後再試 */ });
}

/** 播一次音效。rate：播放速度（微調音高，讓連續的牌聲不要一模一樣） */
export function playSfx(name: Sfx, opts: { rate?: number; gain?: number } = {}) {
  if (!ctx || !sfxGain || sfxVol <= 0) return;
  const buf = buffers.get(name);
  if (!buf) return;
  const now = ctx.currentTime;
  if (now - (lastPlayed.get(name) ?? -1) < 0.05) return;
  lastPlayed.set(name, now);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? 0.94 + Math.random() * 0.12;
  if (opts.gain !== undefined && opts.gain !== 1) {
    const g = ctx.createGain();
    g.gain.value = opts.gain;
    src.connect(g).connect(sfxGain);
  } else src.connect(sfxGain);
  src.start();
}

/** 除錯／測試用：目前的播放狀態 */
export function audioStatus() {
  return { ctx: ctx?.state ?? 'none', bgmPaused: bgm?.paused ?? true, bgmTime: bgm?.currentTime ?? 0, sfxLoaded: [...buffers.keys()], music: musicGain?.gain.value ?? 0, sfx: sfxGain?.gain.value ?? 0 };
}
