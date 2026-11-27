import Peer, { type DataConnection } from 'peerjs';
import { Game, botStep, viewFor, isValidTeam, type Action, type GameState, type PlayerIdx, type Team } from '../engine';
import { PEER_ID_PREFIX, BOT_DELAY_MS, ALLOW_SAME_CHAR_IN_TEAM } from '../config';

// =====================================================================
// Session：畫面只跟 Session 溝通，不管是本機、電腦對手、還是連線
//  本機模式在建立 Session 之前就選好角色；連線模式連上之後由 Session 通知畫面「請選角」
// =====================================================================

export type Mode = 'hotseat' | 'bot' | 'host' | 'guest';

export interface SessionEvents {
  onState(view: GameState, me: PlayerIdx): void;
  onStatus(text: string): void;   // 連線、選角狀態文字
  onError(text: string): void;    // 操作被拒絕等
  onNeedTeam(): void;             // 連線模式：請玩家選角
}

export interface Session {
  mode: Mode;
  send(a: Action): void;
  /** 同樣的隊伍再打一局 */
  rematch(): void;
  /** 連線模式：送出自己選好的隊伍 */
  submitTeam(team: Team): void;
  /** 連線模式：雙方回到選角 */
  reselect(): void;
  close(): void;
}

/** 每局的亂數種子（引擎只用這個種子，不自己取亂數） */
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export function randomRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---------------------------------------------------------------------
// 本機：雙人同螢幕／對戰電腦
// ---------------------------------------------------------------------
export class LocalSession implements Session {
  game!: Game;
  private botTimer: any = null;
  constructor(public mode: 'hotseat' | 'bot', private ev: SessionEvents, private names: [string, string], private teams: [Team, Team]) {
    this.newGame();
  }
  private newGame() {
    this.game = Game.create({ seed: newSeed(), names: this.names, chars: this.teams });
    this.emit();
  }
  private me(): PlayerIdx {
    if (this.mode === 'bot') return 0;
    return this.game.actor() ?? this.game.state.active;
  }
  private emit() {
    this.ev.onState(viewFor(this.game.state, this.mode === 'bot' ? 0 : this.me()), this.me());
    if (this.mode === 'bot') this.scheduleBot();
  }
  private scheduleBot() {
    clearTimeout(this.botTimer);
    if (this.game.actor() !== 1) return;
    this.botTimer = setTimeout(() => {
      const a = botStep(this.game, 1, Math.random);
      if (a) this.game.apply(1, a);
      this.emit();
    }, BOT_DELAY_MS);
  }
  send(a: Action) {
    const who = this.mode === 'bot' ? 0 : (this.game.actor() ?? this.game.state.active);
    const r = this.game.apply(who, a);
    if (!r.ok) this.ev.onError(r.error ?? '無效操作');
    this.emit();
  }
  rematch() { this.newGame(); }
  submitTeam() { /* 本機模式在建立前就選好了 */ }
  reselect() { /* 本機模式由畫面重新走選角流程 */ }
  close() { clearTimeout(this.botTimer); }
}

// ---------------------------------------------------------------------
// 連線：PeerJS 端對端。房主跑遊戲規則（權威），客人只送操作
// ---------------------------------------------------------------------
type Msg =
  | { type: 'hello'; name: string }
  | { type: 'needTeam' }
  | { type: 'team'; team: Team }
  | { type: 'reselect' }
  | { type: 'action'; action: Action }
  | { type: 'rematch' }
  | { type: 'state'; view: GameState; me: PlayerIdx }
  | { type: 'status'; text: string }
  | { type: 'error'; text: string };

function peerOptions(): any {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerHost');
  if (!host) return { debug: 1 };
  return {
    host, port: Number(q.get('peerPort') ?? 9000), path: q.get('peerPath') ?? '/', secure: q.get('peerSecure') === '1', debug: 1,
  };
}

export class HostSession implements Session {
  mode = 'host' as const;
  private peer: Peer;
  private conn: DataConnection | null = null;
  private game: Game | null = null;
  private guestName = '對手';
  private teams: [Team | null, Team | null] = [null, null];

  private closed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public code: string, private myName: string, private ev: SessionEvents) {
    this.peer = new Peer(PEER_ID_PREFIX + code, peerOptions());
    ev.onStatus('正在建立房間…');
    this.peer.on('open', () => {
      if (!this.conn?.open) ev.onStatus(`房間已建立，房號 ${code}，等待對手加入…`);
    });
    // 手機切到背景（例如去 LINE 傳房號）時，和連線伺服器的連線常常會斷：自動重連，房號不變
    this.peer.on('disconnected', () => this.reconnectSoon());
    document.addEventListener('visibilitychange', this.onVisible);
    this.peer.on('error', (e: any) => {
      const t = e?.type;
      if (t === 'unavailable-id') ev.onError('這個房號已被使用，請換一個');
      // 有人加入到一半就離開（或連不上）：房間還在，不算錯誤
      else if (t === 'peer-unavailable') { if (!this.conn?.open) ev.onStatus(`有人嘗試加入但中途斷線，請對方再按一次「加入」（房號 ${code}）`); }
      else if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'disconnected') this.reconnectSoon();
      else ev.onError('連線錯誤：' + (t ?? e));
    });
    this.peer.on('connection', c => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ type: 'error', text: '房間已滿' }); setTimeout(() => c.close(), 500); }); return; }
      this.conn = c;
      c.on('data', d => this.onMsg(d as Msg));
      c.on('close', () => ev.onStatus('對手已離線'));
    });
  }
  private onVisible = () => { if (!document.hidden && this.peer.disconnected) this.reconnectSoon(0); };
  /** 和連線伺服器斷線時重連（每 2 秒試一次，直到連上或關閉房間） */
  private reconnectSoon(delay = 1000) {
    if (this.closed || this.peer.destroyed || this.retryTimer) return;
    if (!this.conn?.open) this.ev.onStatus(`和連線伺服器斷線，重新連線中…（房號 ${this.code}）`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.closed || this.peer.destroyed || !this.peer.disconnected) return;
      try { this.peer.reconnect(); } catch { /* 下一次 disconnected／error 會再排 */ }
      setTimeout(() => { if (this.peer.disconnected) this.reconnectSoon(2000); }, 4000);
    }, delay);
  }
  private sendGuest(m: Msg) { this.conn?.send(m); }
  private onMsg(m: Msg) {
    // 對方送來的資料不能完全相信：每一種都要檢查
    if (m.type === 'hello') {
      this.guestName = String(m.name || '對手').slice(0, 12);
      if (this.game) this.broadcast();
      else this.askTeams();
    } else if (m.type === 'team') {
      if (this.game) return;
      if (!isValidTeam(m.team, ALLOW_SAME_CHAR_IN_TEAM)) { this.sendGuest({ type: 'error', text: '隊伍不合法' }); return; }
      this.teams[1] = [m.team[0], m.team[1]];
      this.ev.onStatus(`${this.guestName} 已選好角色`);
      this.tryStart();
    } else if (m.type === 'action' && this.game) {
      const r = this.game.apply(1, m.action);
      if (!r.ok) this.sendGuest({ type: 'error', text: r.error ?? '無效操作' });
      this.broadcast();
    } else if (m.type === 'rematch') {
      this.start();
    } else if (m.type === 'reselect') {
      this.reselect();
    }
  }
  /** 雙方回到選角 */
  private askTeams() {
    this.game = null;
    this.teams = [null, null];
    this.ev.onNeedTeam();
    this.sendGuest({ type: 'needTeam' });
  }
  private tryStart() {
    const [host, guest] = this.teams;
    if (host && guest) this.start();
    else if (host) { this.ev.onStatus(`等待 ${this.guestName} 選角…`); this.sendGuest({ type: 'status', text: '房主已選好，輪到你了' }); }
    else if (guest) this.sendGuest({ type: 'status', text: '已送出，等待房主選角…' });
  }
  private start() {
    if (!this.teams[0] || !this.teams[1]) return;
    this.game = Game.create({ seed: newSeed(), names: [this.myName, this.guestName], chars: [this.teams[0], this.teams[1]] });
    this.broadcast();
  }
  private broadcast() {
    if (!this.game) return;
    this.ev.onState(viewFor(this.game.state, 0), 0);
    this.sendGuest({ type: 'state', view: viewFor(this.game.state, 1), me: 1 });
  }
  submitTeam(team: Team) {
    if (this.game || !isValidTeam(team, ALLOW_SAME_CHAR_IN_TEAM)) return;
    this.teams[0] = team;
    this.tryStart();
  }
  send(a: Action) {
    if (!this.game) return;
    const r = this.game.apply(0, a);
    if (!r.ok) this.ev.onError(r.error ?? '無效操作');
    this.broadcast();
  }
  rematch() { this.start(); }
  reselect() { this.askTeams(); }
  close() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.conn?.close(); this.peer.destroy();
  }
}

export class GuestSession implements Session {
  mode = 'guest' as const;
  private peer: Peer;
  private conn: DataConnection | null = null;

  private closed = false;
  private tries = 0;
  private static readonly MAX_TRIES = 5;

  constructor(private code: string, private myName: string, private ev: SessionEvents) {
    this.peer = new Peer(peerOptions());
    ev.onStatus('正在連線…');
    this.peer.on('open', () => { if (!this.conn) this.connect(); });
    this.peer.on('disconnected', () => { if (!this.closed && !this.conn?.open) setTimeout(() => { if (!this.closed && this.peer.disconnected) this.peer.reconnect(); }, 1000); });
    this.peer.on('error', (e: any) => {
      if (e?.type === 'peer-unavailable') this.retry('unavailable');
      else if (e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error') this.retry('timeout');
      else ev.onError('連線錯誤：' + (e?.type ?? e));
    });
  }
  /** 連到房主；10 秒內沒連上就重試（房主可能剛好切到背景、正在重連） */
  private connect() {
    if (this.closed) return;
    const c = this.peer.connect(PEER_ID_PREFIX + this.code, { reliable: true });
    this.conn = c;
    const timer = setTimeout(() => { if (!c.open && this.conn === c) { c.close(); this.retry('timeout'); } }, 10000);
    c.on('open', () => {
      clearTimeout(timer);
      this.tries = 0;
      this.ev.onStatus('已連上房間');
      c.send({ type: 'hello', name: this.myName } satisfies Msg);
    });
    c.on('data', d => {
      const m = d as Msg;
      if (m.type === 'state') this.ev.onState(m.view, m.me);
      else if (m.type === 'needTeam') this.ev.onNeedTeam();
      else if (m.type === 'status') this.ev.onStatus(m.text);
      else if (m.type === 'error') this.ev.onError(m.text);
    });
    let wasOpen = false;
    c.on('open', () => { wasOpen = true; });
    c.on('close', () => { clearTimeout(timer); if (!this.closed && wasOpen) this.ev.onStatus('與房主的連線中斷'); });
  }
  private retry(why: 'unavailable' | 'timeout') {
    if (this.closed) return;
    this.tries++;
    if (this.tries < GuestSession.MAX_TRIES) {
      this.ev.onStatus(`${why === 'unavailable' ? '找不到房間' : '還連不上房主'}，重試中（${this.tries}/${GuestSession.MAX_TRIES - 1}）…`);
      setTimeout(() => this.connect(), 2500);
      return;
    }
    this.ev.onError(why === 'unavailable'
      ? `找不到房間 ${this.code}：請確認房號，並請房主回到遊戲畫面（房主切到別的 App 太久會斷線）`
      : '連不上房主：可能是網路擋住了端對端連線。可以試試兩邊連同一個 Wi‑Fi，或換一個網路（例如改用行動網路）');
  }
  private sendHost(m: Msg) { this.conn?.send(m); }
  send(a: Action) { this.sendHost({ type: 'action', action: a }); }
  submitTeam(team: Team) { this.sendHost({ type: 'team', team }); }
  rematch() { this.sendHost({ type: 'rematch' }); }
  reselect() { this.sendHost({ type: 'reselect' }); }
  close() { this.closed = true; this.conn?.close(); this.peer.destroy(); }
}
