import {
  type C2S,
  CLOSE,
  type ErrorCode,
  PING_HIDDEN,
  PING_VISIBLE,
  PONG_TIMEOUT,
  RECONNECT_MAX,
  RECONNECT_MIN,
  REQUEST_TIMEOUT,
  type S2C,
} from '@dropzy/shared';
import { wsUrl } from './api';

// One WebSocket per tab (§8). Reconnects with backoff, pings sparingly, acks every request.

export type Terminal = 'not_found' | 'ended' | 'forbidden' | 'locked' | 'capacity';

export class RequestError extends Error {
  constructor(
    public code: ErrorCode | 'timeout' | 'offline',
    public retryAfter?: number,
  ) {
    super(code);
  }
}

type Pending = { resolve: (v: any) => void; reject: (e: RequestError) => void; timer: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type Outgoing = DistributiveOmit<Extract<C2S, { rid: string }>, 'rid'>;

export type SocketEvents = {
  onMessage: (m: S2C) => void;
  onOpen: () => void; // send hello here
  onDown: () => void;
  onTerminal: (why: Terminal) => void;
};

export class SpaceSocket {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private waitingOpen: (() => void)[] = [];
  private attempt = 0;
  private reconnectTimer = 0;
  private pingTimer = 0;
  private pongTimer = 0;
  private n = 0;
  private stopped = false;
  ready = false; // true after hello → state

  constructor(
    private query: () => string,
    private ev: SocketEvents,
  ) {
    addEventListener('online', this.nudge);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    removeEventListener('online', this.nudge);
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearTimeout(this.reconnectTimer);
    this.clearPing();
    this.ws?.close(1000);
    this.ws = null;
  }

  /** Reconnect with a fresh query (e.g. after joining or leaving a Wi-Fi pass). */
  restart() {
    this.ws?.close(1000);
    this.ws = null;
    this.ready = false;
    this.attempt = 0;
    this.connect();
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.stopped || this.ws) return;
    clearTimeout(this.reconnectTimer);
    const ws = new WebSocket(wsUrl(this.query()));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.schedulePing();
      this.ev.onOpen();
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') {
        clearTimeout(this.pongTimer);
        return;
      }
      let m: S2C;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'ack') {
        const p = this.pending.get(m.rid);
        if (!p) return;
        this.pending.delete(m.rid);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.data);
        else p.reject(new RequestError(m.error, m.retryAfter));
        return;
      }
      if (m.t === 'state') {
        this.ready = true;
        const w = this.waitingOpen.splice(0);
        for (const f of w) f();
      }
      this.ev.onMessage(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      this.clearPing();
      const terminal = terminalFor(e.code, e.reason);
      if (terminal) {
        this.stopped = true;
        this.failPending('offline');
        this.ev.onTerminal(terminal);
        return;
      }
      this.ev.onDown();
      this.scheduleReconnect(e.code === CLOSE.RATE_LIMITED);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(slow = false) {
    if (this.stopped) return;
    // While hidden, wait until the tab is visible (§8.3).
    if (document.hidden) return;
    const base = Math.min(RECONNECT_MAX, RECONNECT_MIN * 2 ** this.attempt);
    const delay = (slow ? Math.max(base, 10_000) : base) * (0.8 + Math.random() * 0.4);
    this.attempt++;
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private nudge = () => {
    if (this.stopped || this.ws) return;
    this.attempt = 0;
    this.connect();
  };

  private onVisibility = () => {
    if (!document.hidden) this.nudge();
    this.schedulePing();
  };

  private schedulePing() {
    clearTimeout(this.pingTimer);
    if (!this.ws) return;
    this.pingTimer = window.setTimeout(
      () => {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send('ping');
        clearTimeout(this.pongTimer);
        this.pongTimer = window.setTimeout(() => this.ws?.close(4000, 'no pong'), PONG_TIMEOUT);
        this.schedulePing();
      },
      document.hidden ? PING_HIDDEN : PING_VISIBLE,
    );
  }

  private clearPing() {
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
  }

  private failPending(code: 'offline') {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new RequestError(code));
    }
    this.pending.clear();
  }

  /** Send hello directly (before the socket is "ready"). */
  sendRaw(msg: C2S) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Fire-and-forget message without rid (progress, signal). Dropped when offline. */
  post(msg: Extract<C2S, { t: 'upload.progress' | 'signal' }>) {
    if (this.ready && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private whenReady(timeout: number): Promise<void> {
    if (this.ready && this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const i = this.waitingOpen.indexOf(done);
        if (i >= 0) this.waitingOpen.splice(i, 1);
        reject(new RequestError('timeout'));
      }, timeout);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.waitingOpen.push(done);
    });
  }

  /**
   * Send a request and wait for its ack. Times out after 10 s; idempotent requests
   * (anything carrying a cid, deletes, reads) are retried once (§8.3).
   */
  async request<T = unknown>(msg: Outgoing, opts: { idempotent?: boolean; hello?: boolean } = {}): Promise<T> {
    const idempotent = opts.idempotent ?? true;
    try {
      return await this.once<T>(msg, opts.hello);
    } catch (e) {
      if (idempotent && e instanceof RequestError && (e.code === 'timeout' || e.code === 'offline') && !this.stopped) {
        return this.once<T>(msg, opts.hello);
      }
      throw e;
    }
  }

  private async once<T>(msg: Outgoing, hello?: boolean): Promise<T> {
    if (!hello) await this.whenReady(REQUEST_TIMEOUT);
    const rid = `${Date.now().toString(36)}${(++this.n).toString(36)}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(rid);
        reject(new RequestError('timeout'));
      }, REQUEST_TIMEOUT);
      this.pending.set(rid, { resolve, reject, timer });
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        clearTimeout(timer);
        this.pending.delete(rid);
        reject(new RequestError('offline'));
        return;
      }
      ws.send(JSON.stringify({ ...msg, rid }));
    });
  }
}

function terminalFor(code: number, reason: string): Terminal | null {
  if (code === CLOSE.NOT_FOUND) return 'not_found';
  if (code === CLOSE.ENDED) return 'ended';
  if (code === CLOSE.AT_CAPACITY) return 'capacity';
  if (code === CLOSE.FORBIDDEN) return reason === 'locked' ? 'locked' : 'forbidden';
  if (code === CLOSE.BAD_REQUEST) return 'not_found';
  return null;
}
