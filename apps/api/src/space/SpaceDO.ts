import {
  CLOSE,
  type DeviceType,
  type ErrorCode,
  HOUR,
  type Item,
  MAX_ITEMS_PER_DEVICE,
  MAX_ITEMS_PER_SPACE,
  MAX_MESSAGE_BYTES,
  type PeerList,
  ROOM_EXTEND,
  ROOM_MAX,
  ROOM_TTL,
  type S2C,
  SES_EXTEND,
  SES_MAX,
  SES_TTL,
  STALE_SOCKET,
  type SpaceInfo,
  type SpaceKind,
  TEXT_MAX,
  WIFI_ITEM_TTL,
  b64url,
  cleanDeviceName,
  cleanText,
  randomDeviceName,
  randomSearchCode,
  randomToken,
} from '@dropzy/shared';
import { DurableObject } from 'cloudflare:workers';
import { type Env, num, storageEnabled } from '../env';
import { type C2SMsg, C2SSchema } from './schema';

// One Durable Object per Wi-Fi network / private share / room (§4.1).
// Hibernation API only; no timers; per-socket state in attachments (§8.5).

export type SpaceRow = {
  kind: SpaceKind;
  created_at: number;
  expires_at: number | null;
  max_expires_at: number | null;
  room_code: string | null;
  locked: number;
  busy_until: number | null;
};

export type ItemRow = {
  id: string;
  type: 'text' | 'file';
  cid: string;
  code: string | null;
  device: string;
  device_name: string;
  device_type: DeviceType;
  ip_hash: string;
  delete_hash: string | null;
  created_at: number;
  expires_at: number;
  body: string | null;
  name: string | null;
  mime: string | null;
  size: number | null;
  enc_meta: string | null;
  thumb: string | null;
  e2ee: number;
  storage_key: string | null;
  upload_id: string | null;
  part_size: number | null;
  status: 'uploading' | 'ready' | null;
  burn: number;
  consumed_at: number | null;
};

type Bucket = [tokens: number, last: number];

export type Att = {
  peerId: string;
  ipHash: string;
  viaPass: boolean;
  ready: boolean;
  deviceHash?: string;
  name?: string;
  type?: DeviceType;
  caps?: { direct: boolean; maxDirectBytes: number };
  found: string[];
  b: Record<string, Bucket>;
  seen: number;
};

// Per-socket token buckets: [capacity, period ms] (§8.5, §7.1)
const LIMITS: Record<string, [number, number]> = {
  all: [30, 10_000],
  'text.add': [20, 60_000],
  'upload.init': [30, 600_000],
  find: [10, 60_000],
  signal: [200, 60_000],
  'pass.create': [5, 600_000],
};

const SWEEP_EVERY = 60_000;

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public retryAfter?: number,
  ) {
    super(code);
  }
}

export class SpaceDO extends DurableObject<Env> {
  protected sql: SqlStorage;
  private spaceCache: SpaceRow | null | undefined;
  private alarmCache: number | null | undefined;
  private lastSweep = 0;
  protected progress = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.migrate();
    // Pings never wake the object (§8.4).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }


  /** Tables are recreated after deleteAll(), since late socket events can still arrive. */
  protected migrate() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS space (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER, max_expires_at INTEGER,
      room_code TEXT, locked INTEGER NOT NULL DEFAULT 0,
      busy_until INTEGER
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      cid TEXT NOT NULL,
      code TEXT,
      device TEXT NOT NULL, device_name TEXT NOT NULL, device_type TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      delete_hash TEXT,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      body TEXT,
      name TEXT, mime TEXT, size INTEGER, enc_meta TEXT, thumb TEXT,
      e2ee INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT, upload_id TEXT, part_size INTEGER,
      status TEXT, burn INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS members (device TEXT PRIMARY KEY);`);
  }

  // ───────────────────────── space row ─────────────────────────

  protected space(): SpaceRow | null {
    if (this.spaceCache === undefined) {
      this.spaceCache = this.sql.exec<SpaceRow>('SELECT * FROM space WHERE id = 1').toArray()[0] ?? null;
    }
    return this.spaceCache;
  }

  protected updateSpace(patch: Partial<SpaceRow>) {
    const keys = Object.keys(patch) as (keyof SpaceRow)[];
    if (!keys.length) return;
    this.sql.exec(
      `UPDATE space SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`,
      ...keys.map((k) => patch[k] as SqlStorageValue),
    );
    this.spaceCache = { ...(this.space() as SpaceRow), ...patch };
  }

  private ensureNet(): SpaceRow {
    let s = this.space();
    if (!s) {
      s = { kind: 'net', created_at: Date.now(), expires_at: null, max_expires_at: null, room_code: null, locked: 0, busy_until: null };
      this.sql.exec('INSERT INTO space (id, kind, created_at) VALUES (1, ?, ?)', 'net', s.created_at);
      this.spaceCache = s;
    }
    return s;
  }

  /** Create a Private Share or Room (RPC from the Worker). */
  async init(kind: 'ses' | 'room', roomCode?: string): Promise<{ expiresAt: number }> {
    if (this.space()) throw new Error('exists');
    const now = Date.now();
    const expiresAt = now + (kind === 'ses' ? SES_TTL : ROOM_TTL);
    const max = now + (kind === 'ses' ? SES_MAX : ROOM_MAX);
    this.sql.exec(
      'INSERT INTO space (id, kind, created_at, expires_at, max_expires_at, room_code) VALUES (1, ?, ?, ?, ?, ?)',
      kind,
      now,
      expiresAt,
      max,
      roomCode ?? null,
    );
    this.spaceCache = undefined;
    await this.scheduleAlarm();
    return { expiresAt };
  }

  protected ref(): string {
    const hex = this.ctx.id.toString();
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return b64url(bytes);
  }

  protected busy(now = Date.now()): boolean {
    const s = this.space();
    return !!s && s.kind === 'net' && !!s.busy_until && s.busy_until > now;
  }

  protected uploadsState(): SpaceInfo['uploads'] {
    return storageEnabled(this.env) ? 'on' : 'off';
  }

  protected spaceInfo(att?: Att): SpaceInfo {
    const s = this.space() as SpaceRow;
    const info: SpaceInfo = { kind: s.kind, ref: this.ref(), uploads: this.uploadsState() };
    if (s.kind !== 'net') {
      info.expiresAt = s.expires_at ?? undefined;
      info.maxExpiresAt = s.max_expires_at ?? undefined;
    }
    if (s.kind === 'room') {
      info.code = s.room_code ?? undefined;
      info.locked = !!s.locked;
    }
    if (s.kind === 'net') {
      info.busy = this.busy();
      info.viaPass = !!att?.viaPass;
    }
    return info;
  }

  // ───────────────────────── sockets ─────────────────────────

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const kind = req.headers.get('x-dz-kind');
    const ipHash = req.headers.get('x-dz-ip') || '';
    const viaPass = req.headers.get('x-dz-via-pass') === '1';

    let s = this.space();
    if (!s && kind === 'net') s = this.ensureNet();
    if (!s || s.kind !== kind) return closeWith(CLOSE.NOT_FOUND, 'not_found');
    if (s.expires_at && s.expires_at <= Date.now()) {
      await this.endSpace();
      return closeWith(CLOSE.ENDED, 'ended');
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const peerId = randomToken(9);
    this.ctx.acceptWebSocket(server, [`peer:${peerId}`]);
    const att: Att = { peerId, ipHash, viaPass, ready: false, found: [], b: {}, seen: Date.now() };
    server.serializeAttachment(att);
    return new Response(null, { status: 101, webSocket: client });
  }

  protected sockets(): { ws: WebSocket; att: Att }[] {
    const out: { ws: WebSocket; att: Att }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const att = ws.deserializeAttachment() as Att | null;
      if (att?.ready) out.push({ ws, att });
    }
    return out;
  }

  protected send(ws: WebSocket, msg: S2C) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket already gone
    }
  }

  protected broadcast(msg: S2C, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const { ws } of this.sockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {}
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const size = typeof raw === 'string' ? raw.length : raw.byteLength;
    if (typeof raw !== 'string' || size > MAX_MESSAGE_BYTES) {
      ws.close(CLOSE.BAD_REQUEST, 'bad_request');
      return;
    }
    this.sweep();

    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      ws.close(CLOSE.BAD_REQUEST, 'bad_request');
      return;
    }
    const parsed = C2SSchema.safeParse(data);
    const rid: string | undefined = typeof data?.rid === 'string' ? data.rid.slice(0, 40) : undefined;
    if (!parsed.success) {
      if (rid) this.send(ws, { t: 'ack', rid, ok: false, error: 'bad_request' });
      return;
    }
    const msg = parsed.data;
    const att = ws.deserializeAttachment() as Att;
    att.seen = Date.now();

    try {
      if (!att.ready && msg.t !== 'hello') throw new ApiError('forbidden');
      this.take(att, 'all');
      if (LIMITS[msg.t]) this.take(att, msg.t);
      const result = await this.handle(ws, att, msg);
      if (ws.readyState === WebSocket.OPEN) ws.serializeAttachment(att);
      if ('rid' in msg && result !== NO_ACK) this.send(ws, { t: 'ack', rid: msg.rid, ok: true, data: result });
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) ws.serializeAttachment(att);
      if (err instanceof ApiError) {
        if (rid) this.send(ws, { t: 'ack', rid, ok: false, error: err.code, retryAfter: err.retryAfter });
      } else {
        console.error('space handler', (err as Error)?.name, (err as Error)?.message);
        if (rid) this.send(ws, { t: 'ack', rid, ok: false, error: 'bad_request' });
      }
    }
  }

  /** Token bucket per socket. Throws rate_limited. */
  private take(att: Att, key: string) {
    const [cap, period] = LIMITS[key];
    const now = Date.now();
    const [tokens, last] = att.b[key] ?? [cap, now];
    const refilled = Math.min(cap, tokens + ((now - last) * cap) / period);
    if (refilled < 1) {
      att.b[key] = [refilled, now];
      throw new ApiError('rate_limited', Math.ceil(((1 - refilled) * period) / cap / 1000));
    }
    att.b[key] = [refilled - 1, now];
  }

  protected async handle(ws: WebSocket, att: Att, msg: C2SMsg): Promise<unknown> {
    switch (msg.t) {
      case 'hello':
        return this.onHello(ws, att, msg);
      case 'text.add':
        return this.onTextAdd(att, msg);
      case 'item.delete':
        return this.onDelete(att, msg);
      case 'space.extend':
        return this.onExtend();
      case 'room.lock':
        return this.onLock(msg.locked);
      case 'device.rename':
        return this.onRename(ws, att, msg.name);
      case 'signal':
        return this.onSignal(att, msg);
      default:
        return this.handleMore(ws, att, msg);
    }
  }

  /** Extension point for uploads, passes and search (later phases). */
  protected async handleMore(_ws: WebSocket, _att: Att, _msg: C2SMsg): Promise<unknown> {
    throw new ApiError('bad_request');
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code);
    } catch {}
    this.broadcastPeers(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPeers(ws);
  }

  /** Close sockets whose last ping is older than 6 min (§8.4). No timers: runs when the object wakes. */
  private sweep() {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_EVERY) return;
    this.lastSweep = now;
    let closed = false;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Att | null;
      const ping = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(ping, att?.seen ?? 0);
      if (now - last > STALE_SOCKET) {
        try {
          ws.close(1001, 'stale');
        } catch {}
        closed = true;
      }
    }
    if (closed) this.broadcastPeers();
  }

  // ───────────────────────── presence ─────────────────────────

  protected peers(except?: WebSocket): PeerList {
    const list = this.sockets().filter((s) => s.ws !== except);
    if (this.busy()) return { count: new Set(list.map((s) => s.att.deviceHash)).size };
    return list.map(({ att }) => ({ peerId: att.peerId, name: att.name as string, type: att.type as DeviceType }));
  }

  /** Tell everyone who's here. `gone` is left out of the list (closing socket); `skip` gets no message. */
  protected broadcastPeers(gone?: WebSocket, skip?: WebSocket) {
    this.broadcast({ t: 'peers', peers: this.peers(gone) }, skip ?? gone);
  }

  protected sendState(ws: WebSocket, att: Att) {
    const items = this.liveItems()
      .filter((r) => this.canSee(att, r))
      .map((r) => this.toItem(r, att));
    this.send(ws, { t: 'state', you: { peerId: att.peerId }, space: this.spaceInfo(att), items, peers: this.peers() });
  }

  private async onHello(ws: WebSocket, att: Att, msg: Extract<C2SMsg, { t: 'hello' }>) {
    if (att.ready) {
      this.sendState(ws, att);
      return;
    }
    const s = this.space();
    if (!s) throw new ApiError('not_found');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg.deviceId));
    att.deviceHash = b64url(digest).slice(0, 16);
    att.name = cleanDeviceName(msg.name) ?? randomDeviceName();
    att.type = msg.type as DeviceType;
    att.caps = msg.caps;

    if (s.kind === 'room') {
      const member = this.sql.exec('SELECT 1 FROM members WHERE device = ?', att.deviceHash).toArray().length > 0;
      if (!member) {
        if (s.locked) {
          ws.close(CLOSE.FORBIDDEN, 'locked');
          return NO_ACK;
        }
        this.sql.exec('INSERT OR IGNORE INTO members (device) VALUES (?)', att.deviceHash);
      }
    }

    att.ready = true;
    ws.serializeAttachment(att);

    if (s.kind === 'net' && this.checkBusy()) {
      // Visibility changed for everyone: resend full state.
      for (const o of this.sockets()) this.sendState(o.ws, o.att);
    } else {
      this.sendState(ws, att);
      this.broadcastPeers(undefined, ws);
    }
    return undefined;
  }

  /** Busy-network mode: 7+ distinct devices at once → on for 2 h (§7.1). Returns true when it just turned on. */
  private checkBusy(): boolean {
    const threshold = num(this.env.BUSY_NETWORK_DEVICES, 7);
    const devices = new Set(this.sockets().map((s) => s.att.deviceHash)).size;
    if (devices < threshold) return false;
    const now = Date.now();
    const wasBusy = this.busy(now);
    const until = this.space()?.busy_until ?? 0;
    // Refresh at most every 15 min to save row writes.
    if (!wasBusy || until - now < 2 * HOUR - 15 * 60_000) {
      this.updateSpace({ busy_until: now + 2 * HOUR });
      void this.scheduleAlarm();
    }
    return !wasBusy;
  }

  private onRename(ws: WebSocket, att: Att, name: string) {
    const clean = cleanDeviceName(name);
    if (!clean) throw new ApiError('bad_request');
    att.name = clean;
    ws.serializeAttachment(att);
    this.broadcastPeers();
    return { name: clean };
  }

  private onSignal(att: Att, msg: Extract<C2SMsg, { t: 'signal' }>) {
    if (this.busy()) throw new ApiError('forbidden');
    for (const ws of this.ctx.getWebSockets(`peer:${msg.to}`)) {
      this.send(ws, { t: 'signal', from: att.peerId, data: msg.data });
    }
    return NO_ACK;
  }

  // ───────────────────────── items ─────────────────────────

  protected liveItems(now = Date.now()): ItemRow[] {
    const s = this.space();
    const end = s?.expires_at ?? Number.POSITIVE_INFINITY;
    if (end <= now) return [];
    return this.sql
      .exec<ItemRow>('SELECT * FROM items WHERE consumed_at IS NULL AND expires_at > ? ORDER BY created_at DESC', now)
      .toArray();
  }

  protected getItem(id: string): ItemRow | null {
    return this.sql.exec<ItemRow>('SELECT * FROM items WHERE id = ?', id).toArray()[0] ?? null;
  }

  protected canSee(att: Att, row: ItemRow): boolean {
    if (!this.busy()) return true;
    return row.device === att.deviceHash || att.found.includes(row.id);
  }

  protected effectiveExpiry(row: ItemRow): number {
    const end = this.space()?.expires_at;
    return end ? Math.min(end, row.expires_at) : row.expires_at;
  }

  protected toItem(r: ItemRow, att: Att): Item {
    const item: Item = {
      id: r.id,
      type: r.type,
      mine: r.device === att.deviceHash,
      from: { name: r.device_name, type: r.device_type },
      createdAt: r.created_at,
      expiresAt: this.effectiveExpiry(r),
    };
    if (r.code) item.code = r.code;
    if (r.body !== null) item.body = r.body;
    if (r.type === 'file') {
      if (r.name) item.name = r.name;
      if (r.mime) item.mime = r.mime;
      item.size = r.size ?? 0;
      if (r.enc_meta) item.encMeta = r.enc_meta;
      if (r.thumb) item.thumb = r.thumb;
      item.status = r.status ?? 'ready';
      const pct = this.progress.get(r.id);
      if (r.status === 'uploading' && pct !== undefined) item.pct = pct;
      if (r.burn) item.burn = true;
    }
    if (r.e2ee) item.e2ee = true;
    return item;
  }

  protected broadcastItem(row: ItemRow, t: 'item.added' | 'item.updated' = 'item.added') {
    for (const { ws, att } of this.sockets()) {
      if (this.canSee(att, row)) this.send(ws, { t, item: this.toItem(row, att) });
    }
  }

  /** Common checks and fields for a new item. */
  protected newItemBase(att: Att, cid: string) {
    const s = this.space();
    if (!s) throw new ApiError('not_found');
    const now = Date.now();
    if (s.expires_at && s.expires_at <= now) throw new ApiError('ended');

    const existing = this.getItem(cid);
    if (existing) {
      if (existing.device !== att.deviceHash) throw new ApiError('bad_request');
      return { existing };
    }
    const live = this.liveItems(now);
    if (live.length >= MAX_ITEMS_PER_SPACE) throw new ApiError('space_full');
    if (live.filter((r) => r.device === att.deviceHash).length >= MAX_ITEMS_PER_DEVICE) throw new ApiError('space_full');

    let code: string | null = null;
    if (s.kind === 'net') {
      const used = new Set(live.map((r) => r.code));
      do code = randomSearchCode();
      while (used.has(code));
    }
    return {
      existing: null,
      now,
      code,
      expiresAt: s.kind === 'net' ? now + WIFI_ITEM_TTL : (s.max_expires_at as number),
      e2ee: s.kind === 'ses',
      net: s.kind === 'net',
    };
  }

  protected async makeDeleteToken(): Promise<{ token: string; hash: string }> {
    const token = randomToken(16);
    return { token, hash: await sha256(token) };
  }

  private async onTextAdd(att: Att, msg: Extract<C2SMsg, { t: 'text.add' }>) {
    const base = this.newItemBase(att, msg.cid);
    if (base.existing) return { id: base.existing.id };
    let body: string;
    if (base.e2ee) {
      if (!/^[A-Za-z0-9+/=]+$/.test(msg.body)) throw new ApiError('bad_request');
      body = msg.body;
    } else {
      body = cleanText(msg.body).trim();
      if (!body || body.length > TEXT_MAX) throw new ApiError('bad_request');
    }
    const del = base.net ? await this.makeDeleteToken() : null;
    this.sql.exec(
      `INSERT INTO items (id, type, cid, code, device, device_name, device_type, ip_hash, delete_hash,
        created_at, expires_at, body, e2ee) VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      msg.cid,
      msg.cid,
      base.code,
      att.deviceHash as string,
      att.name as string,
      att.type as string,
      att.ipHash,
      del?.hash ?? null,
      base.now,
      base.expiresAt,
      body,
      base.e2ee ? 1 : 0,
    );
    const row = this.getItem(msg.cid) as ItemRow;
    this.broadcastItem(row);
    await this.scheduleAlarm();
    return { id: row.id, deleteToken: del?.token };
  }

  private async onDelete(att: Att, msg: Extract<C2SMsg, { t: 'item.delete' }>) {
    const row = this.getItem(msg.id);
    if (!row || row.consumed_at) return { id: msg.id };
    const s = this.space() as SpaceRow;
    if (s.kind === 'net') {
      const byToken = msg.deleteToken ? (await sha256(msg.deleteToken)) === row.delete_hash : false;
      if (!byToken && row.device !== att.deviceHash) throw new ApiError('forbidden');
    }
    await this.removeItems([row]);
    await this.scheduleAlarm();
    return { id: msg.id };
  }

  /** Delete rows, their stored bytes, and tell everyone. */
  protected async removeItems(rows: ItemRow[], announce = true) {
    if (!rows.length) return;
    await this.dropStorage(rows);
    for (const r of rows) {
      this.sql.exec('DELETE FROM items WHERE id = ?', r.id);
      this.progress.delete(r.id);
      if (announce) this.broadcast({ t: 'item.removed', id: r.id });
    }
  }

  /** Extension point: delete R2 objects / abort uploads (uploads phase). */
  protected async dropStorage(_rows: ItemRow[]): Promise<void> {}

  // ───────────────────────── extend / lock ─────────────────────────

  private async onExtend() {
    const s = this.space() as SpaceRow;
    if (s.kind === 'net' || !s.expires_at || !s.max_expires_at) throw new ApiError('bad_request');
    if (s.expires_at >= s.max_expires_at) throw new ApiError('max_length');
    const next = Math.min(s.expires_at + (s.kind === 'ses' ? SES_EXTEND : ROOM_EXTEND), s.max_expires_at);
    this.updateSpace({ expires_at: next });
    if (s.room_code) await this.directory().updateRoom(s.room_code, { expiresAt: next });
    await this.scheduleAlarm();
    for (const { ws, att } of this.sockets()) this.send(ws, { t: 'space', space: this.spaceInfo(att) });
    return { expiresAt: next };
  }

  private async onLock(locked: boolean) {
    const s = this.space() as SpaceRow;
    if (s.kind !== 'room') throw new ApiError('bad_request');
    this.updateSpace({ locked: locked ? 1 : 0 });
    if (s.room_code) await this.directory().updateRoom(s.room_code, { locked });
    for (const { ws, att } of this.sockets()) this.send(ws, { t: 'space', space: this.spaceInfo(att) });
    return { locked };
  }

  protected directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('directory'));
  }

  // ───────────────────────── expiry ─────────────────────────

  /** The next time something expires; null when nothing is pending. */
  protected nextWake(): number | null {
    const s = this.space();
    if (!s) return null;
    const times: number[] = [];
    if (s.expires_at) times.push(s.expires_at);
    if (s.busy_until && s.busy_until > Date.now()) times.push(s.busy_until);
    const r = this.sql
      .exec<{ t: number | null }>('SELECT MIN(expires_at) AS t FROM items WHERE consumed_at IS NULL')
      .toArray()[0];
    if (r?.t) times.push(r.t);
    times.push(...this.extraWakeTimes());
    return times.length ? Math.min(...times) : null;
  }

  /** Extension point: burn grace periods and stale uploads. */
  protected extraWakeTimes(): number[] {
    return [];
  }

  /** Single alarm set to the next expiry; only written when the time actually changes (§7.4). */
  protected async scheduleAlarm() {
    const next = this.nextWake();
    if (this.alarmCache === undefined) this.alarmCache = await this.ctx.storage.getAlarm();
    if (next === this.alarmCache) return;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
    this.alarmCache = next;
  }

  async alarm(): Promise<void> {
    this.alarmCache = null;
    const s = this.space();
    if (!s) return;
    const now = Date.now();
    if (s.expires_at && s.expires_at <= now) {
      await this.endSpace();
      return;
    }
    const expired = this.sql
      .exec<ItemRow>('SELECT * FROM items WHERE consumed_at IS NULL AND expires_at <= ?', now)
      .toArray();
    await this.removeItems(expired);
    await this.expireMore(now);

    if (s.kind === 'net' && s.busy_until && s.busy_until <= now) {
      this.updateSpace({ busy_until: null });
      for (const o of this.sockets()) this.sendState(o.ws, o.att);
    }

    const remaining = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM items').toArray()[0].n;
    if (s.kind === 'net' && remaining === 0 && this.sockets().length === 0) {
      // Nothing left on this network: drop the row entirely.
      await this.ctx.storage.deleteAll();
      this.migrate();
      this.spaceCache = undefined;
      this.alarmCache = undefined;
      return;
    }
    await this.scheduleAlarm();
  }

  /** Extension point: burn items and stale uploads. */
  protected async expireMore(_now: number): Promise<void> {}

  protected async endSpace() {
    const s = this.space();
    this.broadcast({ t: 'ended' });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE.ENDED, 'ended');
      } catch {}
    }
    if (s?.room_code) await this.directory().release(s.room_code);
    const rows = this.sql.exec<ItemRow>('SELECT * FROM items').toArray();
    await this.dropStorage(rows);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.migrate();
    this.spaceCache = undefined;
    this.alarmCache = undefined;
    this.progress.clear();
  }
}

export const NO_ACK = Symbol('no-ack');

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** Accept then immediately close, so the browser sees our close code (§8.1). */
export function closeWith(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  const server = pair[1];
  server.accept();
  server.close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}
