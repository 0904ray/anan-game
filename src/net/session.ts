import Peer, { type DataConnection } from 'peerjs';
import { Game, botStep, viewFor, type Action, type GameState, type PlayerIdx } from '../engine';

// =====================================================================
// Session：畫面只跟 Session 溝通，不管是本機、電腦對手、還是連線
// =====================================================================

export type Mode = 'hotseat' | 'bot' | 'host' | 'guest';

export interface SessionEvents {
  onState(view: GameState, me: PlayerIdx): void;
  onStatus(text: string): void;   // 連線狀態文字
  onError(text: string): void;    // 操作被拒絕等
}

export interface Session {
  mode: Mode;
  send(a: Action): void;
  rematch(): void;
  close(): void;
}

const DEFAULT_CHARS: [[string, string], [string, string]] = [['savanna', 'savanna'], ['savanna', 'savanna']];

// ---------------------------------------------------------------------
// 本機：雙人同螢幕／對戰電腦
// ---------------------------------------------------------------------
export class LocalSession implements Session {
  game!: Game;
  private botTimer: any = null;
  constructor(public mode: 'hotseat' | 'bot', private ev: SessionEvents, private names: [string, string]) {
    this.newGame();
  }
  private newGame() {
    this.game = Game.create({ names: this.names, chars: DEFAULT_CHARS });
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
      const a = botStep(this.game, 1);
      if (a) this.game.apply(1, a);
      this.emit();
    }, 650);
  }
  send(a: Action) {
    const who = this.mode === 'bot' ? 0 : (this.game.actor() ?? this.game.state.active);
    const r = this.game.apply(who, a);
    if (!r.ok) this.ev.onError(r.error ?? '無效操作');
    this.emit();
  }
  rematch() { this.newGame(); }
  close() { clearTimeout(this.botTimer); }
}

// ---------------------------------------------------------------------
// 連線：PeerJS 端對端。房主跑遊戲規則（權威），客人只送操作
// ---------------------------------------------------------------------
type Msg =
  | { type: 'hello'; name: string }
  | { type: 'action'; action: Action }
  | { type: 'rematch' }
  | { type: 'state'; view: GameState; me: PlayerIdx }
  | { type: 'error'; text: string };

const ID_PREFIX = 'lenglun-card-';

function peerOptions(): any {
  const q = new URLSearchParams(location.search);
  const host = q.get('peerHost');
  if (!host) return { debug: 1 };
  return {
    host, port: Number(q.get('peerPort') ?? 9000), path: q.get('peerPath') ?? '/', secure: q.get('peerSecure') === '1', debug: 1,
  };
}

export function randomRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class HostSession implements Session {
  mode = 'host' as const;
  private peer: Peer;
  private conn: DataConnection | null = null;
  private game: Game | null = null;
  private guestName = '對手';

  constructor(public code: string, private myName: string, private ev: SessionEvents) {
    this.peer = new Peer(ID_PREFIX + code, peerOptions());
    ev.onStatus('正在建立房間…');
    this.peer.on('open', () => ev.onStatus(`房間已建立，房號 ${code}，等待對手加入…`));
    this.peer.on('error', (e: any) => {
      if (e?.type === 'unavailable-id') ev.onError('這個房號已被使用，請換一個');
      else ev.onError('連線錯誤：' + (e?.type ?? e));
    });
    this.peer.on('connection', c => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ type: 'error', text: '房間已滿' }); setTimeout(() => c.close(), 500); }); return; }
      this.conn = c;
      c.on('data', d => this.onMsg(d as Msg));
      c.on('close', () => ev.onStatus('對手已離線'));
    });
  }
  private onMsg(m: Msg) {
    if (m.type === 'hello') {
      this.guestName = m.name || '對手';
      if (!this.game) this.start();
      else this.broadcast();
    } else if (m.type === 'action' && this.game) {
      const r = this.game.apply(1, m.action);
      if (!r.ok) this.conn?.send({ type: 'error', text: r.error ?? '無效操作' } satisfies Msg);
      this.broadcast();
    } else if (m.type === 'rematch') {
      this.start();
    }
  }
  private start() {
    this.game = Game.create({ names: [this.myName, this.guestName], chars: DEFAULT_CHARS });
    this.ev.onStatus('對戰開始！');
    this.broadcast();
  }
  private broadcast() {
    if (!this.game) return;
    this.ev.onState(viewFor(this.game.state, 0), 0);
    this.conn?.send({ type: 'state', view: viewFor(this.game.state, 1), me: 1 } satisfies Msg);
  }
  send(a: Action) {
    if (!this.game) return;
    const r = this.game.apply(0, a);
    if (!r.ok) this.ev.onError(r.error ?? '無效操作');
    this.broadcast();
  }
  rematch() { this.start(); }
  close() { this.conn?.close(); this.peer.destroy(); }
}

export class GuestSession implements Session {
  mode = 'guest' as const;
  private peer: Peer;
  private conn: DataConnection | null = null;

  constructor(code: string, private myName: string, private ev: SessionEvents) {
    this.peer = new Peer(peerOptions());
    ev.onStatus('正在連線…');
    this.peer.on('open', () => {
      const c = this.peer.connect(ID_PREFIX + code, { reliable: true });
      this.conn = c;
      c.on('open', () => { ev.onStatus('已連上房間，等待開始…'); c.send({ type: 'hello', name: this.myName } satisfies Msg); });
      c.on('data', d => {
        const m = d as Msg;
        if (m.type === 'state') ev.onState(m.view, m.me);
        else if (m.type === 'error') ev.onError(m.text);
      });
      c.on('close', () => ev.onStatus('與房主的連線中斷'));
    });
    this.peer.on('error', (e: any) => {
      if (e?.type === 'peer-unavailable') ev.onError('找不到這個房間，請確認房號');
      else ev.onError('連線錯誤：' + (e?.type ?? e));
    });
  }
  send(a: Action) { this.conn?.send({ type: 'action', action: a } satisfies Msg); }
  rematch() { this.conn?.send({ type: 'rematch' } satisfies Msg); }
  close() { this.conn?.close(); this.peer.destroy(); }
}
