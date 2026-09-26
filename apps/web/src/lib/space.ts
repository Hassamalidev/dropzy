import {
  COUNTDOWN_TICK,
  DEVICE_LABEL,
  type Item,
  type Peer,
  type PeerList,
  type S2C,
  type SpaceInfo,
  TEXT_MAX,
  type TextAddAck,
  UNDO_MS,
  randomId,
} from '@dropzy/shared';
import { t } from '../strings/en';
import { bump, initBadge } from './badge';
import { copyText } from './clipboard';
import { decryptText, encryptText } from './crypto/keys';
import { deleteToken, deviceId, deviceName, deviceType, saveDeleteToken, setDeviceName } from './device';
import { nextUtcMidnight } from './format';
import { RequestError, SpaceSocket, type Terminal } from './socket';
import { type Store, createStore } from './store';

export type Mode = 'wifi' | 'ses' | 'room';
export type Conn = 'connecting' | 'open' | 'offline' | Terminal | 'missing_key';

export type Toast = {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  ms: number;
};

/** Decrypted or derived fields for an item (Private Share). */
export type Plain = { body?: string; name?: string; mime?: string; thumb?: string; failed?: boolean };

export type AppState = {
  mode: Mode;
  conn: Conn;
  everOpen: boolean;
  peerId: string | null;
  space: SpaceInfo | null;
  items: Item[];
  peers: PeerList;
  me: { name: string; type: ReturnType<typeof deviceType> };
  plain: Record<string, Plain>;
  hidden: string[];
  toasts: Toast[];
  now: number;
  live: string; // aria-live announcement
};

export class Space {
  store: Store<AppState>;
  socket: SpaceSocket;
  key: Uint8Array<ArrayBuffer> | null;
  private toastN = 0;
  private tickTimer = 0;
  private pendingDeletes = new Map<string, number>();
  /** Hooks for later features (direct transfer, uploads). */
  protected listeners: ((m: S2C) => void)[] = [];

  constructor(
    public mode: Mode,
    public token: string | null,
    key: Uint8Array<ArrayBuffer> | null,
    private queryFn?: () => string,
  ) {
    this.key = key;
    this.store = createStore<AppState>({
      mode,
      conn: mode === 'ses' && !key ? 'missing_key' : 'connecting',
      everOpen: false,
      peerId: null,
      space: null,
      items: [],
      peers: [],
      me: { name: deviceName(), type: deviceType() },
      plain: {},
      hidden: [],
      toasts: [],
      now: Date.now(),
      live: '',
    });
    this.socket = new SpaceSocket(() => this.query(), {
      onOpen: () => this.hello(),
      onMessage: (m) => this.onMessage(m),
      onDown: () => this.store.set({ conn: 'offline' }),
      onTerminal: (why) => this.store.set({ conn: why }),
    });
  }

  get e2ee() {
    return this.mode === 'ses';
  }

  query(): string {
    if (this.queryFn) return this.queryFn();
    if (this.mode === 'wifi') return 'scope=wifi';
    return `scope=${this.mode}&id=${encodeURIComponent(this.token ?? '')}`;
  }

  start() {
    if (this.store.get().conn === 'missing_key') return;
    initBadge();
    this.socket.start();
    this.tick();
  }

  stop() {
    this.socket.stop();
    clearTimeout(this.tickTimer);
  }

  on(fn: (m: S2C) => void) {
    this.listeners.push(fn);
  }

  // ───────────────────────── connection ─────────────────────────

  protected caps() {
    return { direct: false, maxDirectBytes: 0 };
  }

  private async hello() {
    const me = this.store.get().me;
    try {
      await this.socket.request(
        { t: 'hello', deviceId: deviceId(), name: me.name, type: me.type, caps: this.caps() },
        { hello: true, idempotent: false },
      );
    } catch {
      // onclose handles it
    }
  }

  protected onMessage(m: S2C) {
    const s = this.store.get();
    switch (m.t) {
      case 'state':
        this.store.set({
          conn: 'open',
          everOpen: true,
          peerId: m.you.peerId,
          space: m.space,
          items: sortItems(m.items),
          peers: m.peers,
        });
        for (const it of m.items) this.decrypt(it);
        this.tick();
        break;
      case 'item.added':
      case 'item.updated': {
        const exists = s.items.some((i) => i.id === m.item.id);
        const items = exists ? s.items.map((i) => (i.id === m.item.id ? m.item : i)) : sortItems([m.item, ...s.items]);
        this.store.set({ items });
        if (!exists) {
          this.decrypt(m.item);
          if (!m.item.mine) {
            bump();
            this.announce(m.item);
          }
          this.tick();
        }
        break;
      }
      case 'item.removed':
        this.store.set({ items: s.items.filter((i) => i.id !== m.id) });
        break;
      case 'peers':
        this.arrivals(s.peers, m.peers);
        this.store.set({ peers: m.peers });
        break;
      case 'space':
        this.store.set({ space: m.space });
        this.tick();
        break;
      case 'ended':
        this.store.set({ conn: 'ended' });
        this.socket.stop();
        break;
    }
    for (const fn of this.listeners) fn(m);
  }

  private arrivals(before: PeerList, after: PeerList) {
    if (!Array.isArray(before) || !Array.isArray(after)) return;
    const me = this.store.get().peerId;
    const had = new Set(before.map((p) => p.peerId));
    for (const p of after) {
      if (p.peerId !== me && !had.has(p.peerId)) this.toast(t.devices.arrived(p.name, DEVICE_LABEL[p.type]));
    }
  }

  private announce(item: Item) {
    const what = item.type === 'text' ? t.text.title : t.files.title;
    this.store.set({ live: `${what} · ${t.item.from(item.from.name)}` });
  }

  /** Re-render countdowns every 30 s, and hide items the moment they expire (§7.4). */
  private tick() {
    clearTimeout(this.tickTimer);
    const now = Date.now();
    const s = this.store.get();
    const items = s.items.filter((i) => i.expiresAt > now);
    this.store.set({ now, items: items.length === s.items.length ? s.items : items });
    const next = Math.min(...items.map((i) => i.expiresAt), s.space?.expiresAt ?? Number.POSITIVE_INFINITY);
    const wait = Math.max(250, Math.min(COUNTDOWN_TICK, next - now + 50));
    this.tickTimer = window.setTimeout(() => this.tick(), wait);
  }

  // ───────────────────────── derived ─────────────────────────

  others(): Peer[] {
    const s = this.store.get();
    return Array.isArray(s.peers) ? s.peers.filter((p) => p.peerId !== s.peerId) : [];
  }

  errorText(e: unknown): string {
    const code = e instanceof RequestError ? e.code : 'bad_request';
    switch (code) {
      case 'rate_limited':
        return t.moments.rateLimited;
      case 'space_full':
        return t.moments.spaceFull;
      case 'ended':
        return t.moments.ended;
      case 'uploads_paused':
        return t.moments.uploadsPaused;
      case 'locked':
        return t.moments.locked;
      case 'max_length':
        return t.status.maxReached;
      case 'offline':
      case 'timeout':
        return t.moments.offline;
      default:
        return t.moments.generic;
    }
  }

  capacityText() {
    return t.moments.atCapacity(nextUtcMidnight());
  }

  // ───────────────────────── toasts ─────────────────────────

  toast(text: string, action?: Toast['action'], ms = action ? UNDO_MS : 4000): number {
    const id = ++this.toastN;
    this.store.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, action, ms }] }));
    window.setTimeout(() => this.dismiss(id), ms);
    return id;
  }

  dismiss(id: number) {
    this.store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  }

  // ───────────────────────── text ─────────────────────────

  private async decrypt(item: Item) {
    if (!item.e2ee || !this.key) return;
    try {
      const plain: Plain = {};
      if (item.type === 'text' && item.body) plain.body = await decryptText(this.key, item.id, item.body);
      await this.decryptMore(item, plain);
      this.store.set((s) => ({ plain: { ...s.plain, [item.id]: plain } }));
    } catch {
      this.store.set((s) => ({ plain: { ...s.plain, [item.id]: { failed: true } } }));
    }
  }

  /** Extension point: file metadata and thumbnails (E2EE phase). */
  protected async decryptMore(_item: Item, _plain: Plain): Promise<void> {}

  textOf(item: Item): string | undefined {
    return item.e2ee ? this.store.get().plain[item.id]?.body : item.body;
  }

  /** Returns true when shared. The caller keeps the draft on failure (§6.3). */
  async addText(raw: string): Promise<boolean> {
    const text = raw.trim();
    if (!text) return false;
    if (text.length > TEXT_MAX) {
      this.toast(t.text.tooLong);
      return false;
    }
    const cid = randomId();
    try {
      const body = this.e2ee && this.key ? await encryptText(this.key, cid, text) : text;
      const ack = await this.socket.request<TextAddAck>({ t: 'text.add', cid, body });
      if (ack.deleteToken) saveDeleteToken(ack.id, ack.deleteToken, Date.now() + 2 * 3600_000);
      return true;
    } catch (e) {
      this.toast(this.errorText(e));
      return false;
    }
  }

  async copyLatest() {
    const s = this.store.get();
    const latest = s.items.find((i) => i.type === 'text' && !s.hidden.includes(i.id));
    const text = latest && this.textOf(latest);
    if (!text) {
      this.toast(t.text.nothingToCopy);
      return;
    }
    this.toast((await copyText(text)) ? t.toast.textCopied : t.toast.copyFailed);
  }

  // ───────────────────────── delete with undo ─────────────────────────

  canDelete(item: Item): boolean {
    return this.mode !== 'wifi' || item.mine;
  }

  deleteItem(id: string) {
    this.store.set((s) => ({ hidden: [...s.hidden, id] }));
    const timer = window.setTimeout(() => this.commitDelete(id), UNDO_MS);
    this.pendingDeletes.set(id, timer);
    this.toast(t.moments.deleted, {
      label: t.moments.undo,
      run: () => {
        clearTimeout(timer);
        this.pendingDeletes.delete(id);
        this.store.set((s) => ({ hidden: s.hidden.filter((h) => h !== id) }));
      },
    });
  }

  private async commitDelete(id: string) {
    this.pendingDeletes.delete(id);
    try {
      await this.beforeDelete(id);
      await this.socket.request({ t: 'item.delete', id, deleteToken: deleteToken(id) });
      this.store.set((s) => ({ items: s.items.filter((i) => i.id !== id), hidden: s.hidden.filter((h) => h !== id) }));
    } catch (e) {
      this.store.set((s) => ({ hidden: s.hidden.filter((h) => h !== id) }));
      this.toast(this.errorText(e));
    }
  }

  /** Extension point: cancel a running upload before deleting it. */
  protected async beforeDelete(_id: string): Promise<void> {}

  // ───────────────────────── space actions ─────────────────────────

  async extend() {
    try {
      await this.socket.request({ t: 'space.extend' }, { idempotent: false });
      this.toast(t.status.extended);
    } catch (e) {
      this.toast(this.errorText(e));
    }
  }

  async lock(locked: boolean) {
    try {
      await this.socket.request({ t: 'room.lock', locked });
      this.toast(locked ? t.status.locked : t.status.unlocked);
    } catch (e) {
      this.toast(this.errorText(e));
    }
  }

  async rename(name: string): Promise<boolean> {
    try {
      const r = await this.socket.request<{ name: string }>({ t: 'device.rename', name });
      setDeviceName(r.name);
      this.store.set((s) => ({ me: { ...s.me, name: r.name } }));
      this.toast(t.toast.renamed);
      return true;
    } catch (e) {
      this.toast(this.errorText(e));
      return false;
    }
  }

  shareUrl(): string {
    if (this.mode === 'ses') return location.href.split('#')[0] + location.hash;
    if (this.mode === 'room') {
      const code = this.store.get().space?.code;
      return code ? `${location.origin}/j/${code}` : location.href;
    }
    return location.origin;
  }
}

function sortItems(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}
