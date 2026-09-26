import {
  COUNTDOWN_TICK,
  DIRECT_FILE_TTL,
  IOS_DIRECT_CAP,
  MAX_DIRECT_TARGETS,
  type PassCreateAck,
  type SignalData,
  type DownloadUrlAck,
  GiB,
  DEVICE_LABEL,
  type Item,
  type Peer,
  type PeerList,
  type S2C,
  type SpaceInfo,
  TEXT_MAX,
  type TextAddAck,
  UNDO_MS,
  type UploadInitAck,
  b64url,
  formatBytes,
  randomId,
} from '@dropzy/shared';
import { t } from '../strings/en';
import { bump, initBadge } from './badge';
import { copyText } from './clipboard';
import { decryptStream, encryptedSource, fileKeys, openMeta, openThumb, sealMeta, sealThumb } from './crypto/files';
import { decryptText, encryptText, itemRoot } from './crypto/keys';
import { deleteToken, deviceId, deviceName, deviceType, isIOS, saveDeleteToken, session, setDeviceName, setSession } from './device';
import { nextUtcMidnight } from './format';
import type { Direct } from './direct';
import { cleanTmp, clickLink, hasOpfs, openSink, pipeTo, readWithProgress, saveBlob, type startPicker } from './sink';
import { type Outgoing, RequestError, SpaceSocket, type Terminal } from './socket';
import { makeThumb } from './thumbs';
import { type Source, UploadCancelled, runUpload } from './upload/uploader';
import { zipStream } from './zip';
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

export type Transfer = {
  id: string;
  kind: 'upload' | 'send' | 'recv';
  name: string;
  size: number;
  mime: string;
  loaded: number;
  speed: number; // bytes/s
  state: 'active' | 'done' | 'failed';
  peer?: string; // the other device's name
  saved?: boolean; // received directly and saved
  recovered?: boolean;
};

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
  transfers: Record<string, Transfer>;
  burn: boolean;
};

export class Space {
  store: Store<AppState>;
  socket: SpaceSocket;
  key: Uint8Array<ArrayBuffer> | null;
  private toastN = 0;
  private tickTimer = 0;
  private pendingDeletes = new Map<string, number>();
  protected aborts = new Map<string, AbortController>();
  protected samples = new Map<string, { t: number; loaded: number; speed: number }>();
  readonly maxUpload = Number(import.meta.env.PUBLIC_MAX_UPLOAD_BYTES) || 2 * GiB;
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
      transfers: {},
      burn: false,
    });
    this.socket = new SpaceSocket(() => this.query(), {
      onOpen: () => this.hello(),
      onMessage: (m) => this.onMessage(m),
      onDown: () => this.store.set({ conn: 'offline' }),
      onTerminal: (why) => {
        // An expired or invalid pass: forget it and fall back to normal detection.
        if (this.mode === 'wifi' && session('dz-pass') && why === 'forbidden') {
          this.leavePass();
          return;
        }
        this.store.set({ conn: why });
      },
    });
  }

  get e2ee() {
    return this.mode === 'ses';
  }

  query(): string {
    if (this.queryFn) return this.queryFn();
    if (this.mode === 'wifi') {
      const pass = session('dz-pass');
      return pass ? `scope=pass&id=${encodeURIComponent(pass)}` : 'scope=wifi';
    }
    return `scope=${this.mode}&id=${encodeURIComponent(this.token ?? '')}`;
  }

  start() {
    if (this.store.get().conn === 'missing_key') return;
    initBadge();
    addEventListener('offline', this.onOffline);
    addEventListener('beforeunload', this.onBeforeUnload);
    this.on((m) => {
      if (m.t === 'signal') void this.loadDirect().then((d) => d.onSignal(m.from, m.data as SignalData));
    });
    void this.prepareCaps().finally(() => this.socket.start());
    void this.recover();
    void cleanTmp(DIRECT_FILE_TTL);
    this.tick();
  }

  stop() {
    removeEventListener('offline', this.onOffline);
    removeEventListener('beforeunload', this.onBeforeUnload);
    void this.directP?.then((d) => d.closeAll());
    this.socket.stop();
    clearTimeout(this.tickTimer);
  }

  on(fn: (m: S2C) => void) {
    this.listeners.push(fn);
  }

  // ───────────────────────── connection ─────────────────────────

  private capsCache = { direct: false, maxDirectBytes: 0 };

  protected caps() {
    return this.capsCache;
  }

  /** Direct transfer needs WebRTC and OPFS; the cap is free space − 10 % (1 GiB on iPhone/iPad). */
  private async prepareCaps() {
    const direct = typeof RTCPeerConnection !== 'undefined' && hasOpfs();
    if (!direct) return;
    let free = Number.MAX_SAFE_INTEGER;
    try {
      const e = await navigator.storage.estimate();
      if (e.quota) free = Math.max(0, (e.quota - (e.usage ?? 0)) * 0.9);
    } catch {}
    this.capsCache = { direct, maxDirectBytes: Math.floor(isIOS() ? Math.min(free, IOS_DIRECT_CAP) : free) };
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

  /** Private Share file names, types and thumbnails are sealed with the item's meta key (§10). */
  protected async decryptMore(item: Item, plain: Plain): Promise<void> {
    if (item.type !== 'file' || !this.key) return;
    const { meta } = await this.itemKeys(item.id);
    if (item.encMeta) Object.assign(plain, await openMeta(meta, item.encMeta));
    if (item.thumb) plain.thumb = await openThumb(meta, item.thumb).catch(() => undefined);
  }

  private keyCache = new Map<string, Promise<{ root: Uint8Array<ArrayBuffer>; content: CryptoKey; meta: CryptoKey }>>();

  protected itemKeys(itemId: string) {
    let p = this.keyCache.get(itemId);
    if (!p) {
      p = (async () => {
        const root = await itemRoot(this.key as Uint8Array<ArrayBuffer>, itemId);
        return { root, ...(await fileKeys(root)) };
      })();
      this.keyCache.set(itemId, p);
    }
    return p;
  }

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

  /** Deleting your own running upload cancels it first. */
  protected async beforeDelete(id: string): Promise<void> {
    this.aborts.get(id)?.abort();
  }

  // ───────────────────────── files (§9) ─────────────────────────

  private onOffline = () => {
    const s = this.store.get();
    if (Object.values(s.transfers).some((x) => x.kind === 'upload' && x.state === 'active')) this.toast(t.moments.offlineUpload);
  };

  setTransfer(id: string, patch: Partial<Transfer> | null) {
    this.store.set((s) => {
      const transfers = { ...s.transfers };
      if (patch === null) delete transfers[id];
      else transfers[id] = { ...(transfers[id] as Transfer), ...patch };
      return { transfers };
    });
  }

  /** Rolling transfer speed, updated at most ~4×/s. */
  protected progress(id: string, loaded: number) {
    const now = performance.now();
    const prev = this.samples.get(id);
    if (!prev) {
      this.samples.set(id, { t: now, loaded, speed: 0 });
      this.setTransfer(id, { loaded });
      return;
    }
    if (now - prev.t < 250 && loaded < (this.store.get().transfers[id]?.size ?? Number.POSITIVE_INFINITY)) return;
    const inst = ((loaded - prev.loaded) / (now - prev.t)) * 1000;
    const speed = prev.speed ? prev.speed * 0.7 + inst * 0.3 : inst;
    this.samples.set(id, { t: now, loaded, speed });
    this.setTransfer(id, { loaded, speed: Math.max(0, speed) });
  }

  sendFiles(files: File[]) {
    for (const f of files) void this.sendFile(f);
  }

  /** Decide how a file travels (§9.1). */
  protected async sendFile(file: File) {
    const s = this.store.get();
    const uploads = s.space?.uploads ?? 'off';
    const busy = !Array.isArray(s.peers);
    const others = this.others();
    const canUpload = uploads === 'on' && file.size <= this.maxUpload;
    const direct = this.supportsDirect() && !busy;

    // Wi-Fi or Private, exactly one other device here → direct, falling back to upload.
    if (this.mode !== 'room' && direct && others.length === 1) return this.sendDirect(file, others[0], canUpload);
    if (canUpload) return this.uploadFile(file);

    // Upload impossible: direct to each device here (max 4; never on busy networks).
    if (busy) return void this.toast(t.moments.busyBusyDirect);
    if (!direct || !others.length) {
      if (uploads === 'paused') this.toast(t.moments.uploadsPaused);
      else if (uploads === 'off') this.toast(t.moments.uploadsOffNobody);
      else this.toast(t.moments.tooBig(formatBytes(this.maxUpload)));
      return;
    }
    for (const p of others.slice(0, MAX_DIRECT_TARGETS)) void this.sendDirect(file, p, false);
  }

  /** Fields and byte source for upload.init; Private Share encrypts (E2EE phase). */
  protected async prepareUpload(cid: string, file: File): Promise<{ fields: Partial<Extract<Outgoing, { t: 'upload.init' }>>; source: Source }> {
    const thumb = await makeThumb(file);
    if (this.e2ee && this.key) {
      // The server only ever sees sizes, times and counts (§10).
      const { content, meta } = await this.itemKeys(cid);
      return {
        fields: {
          encMeta: await sealMeta(meta, { name: file.name, mime: file.type || 'application/octet-stream' }),
          thumb: thumb ? await sealThumb(meta, thumb) : undefined,
        },
        source: encryptedSource(file, cid, content),
      };
    }
    return {
      fields: { name: file.name, mime: file.type || 'application/octet-stream', thumb },
      source: { size: file.size, slice: async (a, b) => file.slice(a, b) },
    };
  }

  async uploadFile(file: File, cid = randomId()) {
    const ac = new AbortController();
    this.aborts.set(cid, ac);
    this.setTransfer(cid, { id: cid, kind: 'upload', name: file.name, size: file.size, mime: file.type, loaded: 0, speed: 0, state: 'active' });
    let started = false;
    try {
      const { fields, source } = await this.prepareUpload(cid, file);
      this.setTransfer(cid, { size: source.size });
      const init = await this.socket.request<UploadInitAck>({
        t: 'upload.init',
        cid,
        size: file.size,
        e2ee: this.e2ee,
        burn: this.store.get().burn,
        ...fields,
      });
      started = true;
      if (init.deleteToken) saveDeleteToken(init.id, init.deleteToken, Date.now() + 2 * 3600_000);
      await runUpload({
        socket: this.socket,
        init,
        source,
        signal: ac.signal,
        phone: /Android|iPhone|iPad|Mobile/.test(navigator.userAgent),
        onProgress: (loaded) => this.progress(cid, loaded),
      });
      this.localFiles.set(cid, file);
    } catch (e) {
      if (started) void this.socket.request({ t: 'upload.abort', id: cid }).catch(() => {});
      if (e instanceof UploadCancelled) this.toast(t.item.cancelled);
      else if (e instanceof RequestError && e.code !== 'timeout' && e.code !== 'offline') this.toast(this.errorText(e));
      else this.toast(t.item.uploadFailed);
    } finally {
      this.aborts.delete(cid);
      this.samples.delete(cid);
      this.setTransfer(cid, null);
    }
  }

  /** Files this tab still holds (for "Make available for later" and instant saves). */
  localFiles = new Map<string, File>();
  protected created = new Map<string, number>();

  /** Sort key for rows that only exist on this device (before the server knows them, or direct). */
  localCreatedAt(id: string): number {
    let at = this.created.get(id);
    if (!at) {
      at = Date.now();
      this.created.set(id, at);
    }
    return at;
  }

  /** Whether this browser can send and receive directly. */
  supportsDirect(): boolean {
    return this.capsCache.direct;
  }

  // ───────────────────────── direct transfer (§9.2) ─────────────────────────

  private directP: Promise<Direct> | null = null;
  received = new Map<string, File>();
  private localThumbs = new Map<string, string | undefined>();

  localThumb(id: string) {
    return this.localThumbs.get(id);
  }

  loadDirect(): Promise<Direct> {
    this.directP ??= import('./direct').then(
      ({ Direct }) =>
        new Direct({
          me: () => this.store.get().peerId,
          signal: (to, data) => this.socket.post({ t: 'signal', to, data }),
          peerName: (id) => this.others().find((p) => p.peerId === id)?.name ?? '',
          maxDirectBytes: () => this.capsCache.maxDirectBytes,
          onIncoming: (meta, from) => {
            this.localCreatedAt(meta.id);
            this.localThumbs.set(meta.id, meta.thumb);
            const peer = this.others().find((p) => p.peerId === from)?.name ?? '';
            this.setTransfer(meta.id, { id: meta.id, kind: 'recv', name: meta.name, size: meta.size, mime: meta.mime, loaded: 0, speed: 0, state: 'active', peer });
          },
          onIncomingProgress: (id, n) => this.progress(id, n),
          onReceived: (r, file) => {
            this.received.set(r.id, file);
            this.samples.delete(r.id);
            this.setTransfer(r.id, { state: 'done', loaded: r.size });
            bump();
            this.store.set({ live: `${t.files.title} · ${t.item.from(r.from)}` });
          },
          onIncomingFailed: (id) => {
            this.samples.delete(id);
            this.setTransfer(id, null);
          },
        }),
    );
    return this.directP;
  }

  private async sendDirect(file: File, peer: Peer, fallback: boolean) {
    const id = randomId();
    const ac = new AbortController();
    this.aborts.set(id, ac);
    this.localCreatedAt(id);
    this.setTransfer(id, { id, kind: 'send', name: file.name, size: file.size, mime: file.type, loaded: 0, speed: 0, state: 'active', peer: peer.name });
    try {
      const thumb = await makeThumb(file);
      this.localThumbs.set(id, thumb);
      const d = await this.loadDirect();
      await d.send(peer, file, id, thumb, (n) => this.progress(id, n), ac.signal);
      this.localFiles.set(id, file);
      this.setTransfer(id, { state: 'done', loaded: file.size });
    } catch (e) {
      this.setTransfer(id, null);
      if (ac.signal.aborted) {
        this.toast(t.item.cancelled);
      } else if (fallback) {
        // Not connected within 8 s, stalled 15 s, or declined → upload instead (§9.1).
        this.toast(t.moments.directFailed);
        await this.uploadFile(file);
      } else {
        const reason = (e as { reason?: string })?.reason;
        this.toast(reason === 'no_space' || reason === 'too_big' ? t.moments.declined : t.moments.generic);
      }
    } finally {
      this.aborts.delete(id);
      this.samples.delete(id);
    }
  }

  /** Remove a directly sent or received file from this device (with Undo). Nothing is on the server. */
  deleteLocal(id: string) {
    this.store.set((s) => ({ hidden: [...s.hidden, id] }));
    const timer = window.setTimeout(() => {
      this.received.delete(id);
      this.localFiles.delete(id);
      this.localThumbs.delete(id);
      this.setTransfer(id, null);
      this.store.set((s) => ({ hidden: s.hidden.filter((h) => h !== id) }));
      void import('./direct').then((m) => m.forgetReceived(id));
    }, UNDO_MS);
    this.toast(t.moments.deleted, {
      label: t.moments.undo,
      run: () => {
        clearTimeout(timer);
        this.store.set((s) => ({ hidden: s.hidden.filter((h) => h !== id) }));
      },
    });
  }

  saveReceived(id: string) {
    const file = this.received.get(id);
    if (!file) return;
    saveBlob(file, file.name);
    this.setTransfer(id, { saved: true });
    void import('./direct').then((m) => m.forgetReceived(id));
  }

  unsavedCount(): number {
    return Object.values(this.store.get().transfers).filter((x) => x.kind === 'recv' && x.state === 'done' && !x.saved).length;
  }

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    const n = this.unsavedCount();
    if (!n) return;
    e.preventDefault();
    e.returnValue = t.moments.unsaved(n);
    return e.returnValue;
  };

  /** Unsaved received files survive a reload (§9.2). */
  private async recover() {
    if (!hasOpfs()) return;
    const { recoverReceived } = await import('./direct');
    const list = await recoverReceived();
    if (!list.length) return;
    for (const { r, file } of list) {
      this.received.set(r.id, file);
      this.created.set(r.id, r.at);
      this.setTransfer(r.id, { id: r.id, kind: 'recv', name: r.name, size: r.size, mime: r.mime, loaded: r.size, speed: 0, state: 'done', peer: r.from, recovered: true });
    }
    this.toast(t.moments.recovered(list.length), {
      label: t.item.save,
      run: () => {
        for (const { r } of list) this.saveReceived(r.id);
      },
    }, 10_000);
  }

  /** Upload a file this tab sent directly, so it's there later too (§9.1). */
  async makeAvailable(id: string) {
    const file = this.localFiles.get(id);
    if (file) await this.uploadFile(file);
  }

  cancelUpload(id: string) {
    this.aborts.get(id)?.abort();
  }

  async downloadUrl(item: Item): Promise<string> {
    const r = await this.socket.request<DownloadUrlAck>({ t: 'download.url', id: item.id }, { idempotent: false });
    return r.url;
  }

  /** `picker` must come from startPicker() inside the click (only needed for encrypted files). */
  async download(item: Item, picker: ReturnType<typeof startPicker> = null) {
    try {
      if (item.e2ee) return await this.downloadEncrypted(item, picker);
      clickLink(await this.downloadUrl(item));
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      this.toast(e instanceof RequestError && e.code === 'not_found' ? t.item.gone : this.errorText(e));
    }
  }

  /** Fetch, decrypt and save through the best sink (§9.5). */
  protected async downloadEncrypted(item: Item, picker: ReturnType<typeof startPicker>): Promise<void> {
    const size = item.size ?? 0;
    if (isIOS() && size > IOS_DIRECT_CAP) {
      this.toast(t.moments.tooBigIphone);
      return;
    }
    const name = this.displayName(item);
    const sink = await openSink(name, picker, item.id, this.displayMime(item));
    const body = await this.openItemStream(item);
    const stream = body instanceof Response ? (body.body as ReadableStream<Uint8Array>) : body;
    const file = await pipeTo(stream, sink);
    if (file) saveBlob(file, name);
  }

  /** The whole (decrypted) file in memory, e.g. for Save to Photos. */
  async fetchFile(item: Item, onPct: (pct: number) => void): Promise<File> {
    if (item.e2ee && isIOS() && (item.size ?? 0) > IOS_DIRECT_CAP) throw new Error('too big');
    const body = await this.openItemStream(item);
    const stream = body instanceof Response ? (body.body as ReadableStream<Uint8Array>) : body;
    return readWithProgress(stream, item.size ?? 0, this.displayName(item), this.displayMime(item), onPct);
  }

  async fileLink(item: Item): Promise<string> {
    const ref = this.store.get().space?.ref;
    return `${location.origin}/f/${ref}.${item.id}${await this.fileLinkKey(item)}`;
  }

  /** Private Share single-file links carry their own key (itemRoot), never K (§10). */
  protected async fileLinkKey(item: Item): Promise<string> {
    if (!item.e2ee || !this.key) return '';
    return `#k=${b64url((await this.itemKeys(item.id)).root)}`;
  }

  async copyFileLink(item: Item) {
    this.toast((await copyText(await this.fileLink(item))) ? t.toast.linkCopied : t.toast.copyFailed);
  }

  /** Items that can go into "Download all": uploaded, ready, not one-download (§9.8). */
  zippable(items: Item[]): Item[] {
    return items.filter((i) => i.type === 'file' && i.status === 'ready' && !i.burn);
  }

  async downloadAll(items: Item[], picker: ReturnType<typeof startPicker>) {
    const list = this.zippable(items);
    const skipped = items.filter((i) => i.type === 'file').length - list.length;
    if (skipped > 0) this.toast(t.files.downloadAllSkipped(skipped));
    if (!list.length) return;
    const tid = randomId();
    this.toast(t.files.zipping);
    try {
      const stream = await zipStream(
        list.map((i) => ({
          name: this.displayName(i),
          size: i.size,
          lastModified: new Date(i.createdAt),
          input: () => this.openItemStream(i),
        })),
      );
      const sink = await openSink(t.files.zipName, picker, tid, 'application/zip');
      const file = await pipeTo(stream, sink);
      if (file) saveBlob(file, t.files.zipName);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') this.toast(t.item.failed);
    }
  }

  /** A readable body for an uploaded item (decrypted in Private Share). */
  protected async openItemStream(item: Item): Promise<Response | ReadableStream<Uint8Array>> {
    const res = await fetch(await this.downloadUrl(item), { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok || !res.body) throw new Error('download');
    if (!item.e2ee) return res;
    const { content } = await this.itemKeys(item.id);
    return res.body.pipeThrough(decryptStream(item.id, content, item.size ?? 0));
  }

  displayName(item: Item): string {
    return (item.e2ee ? this.store.get().plain[item.id]?.name : item.name) ?? 'file';
  }

  displayMime(item: Item): string | undefined {
    return item.e2ee ? this.store.get().plain[item.id]?.mime : item.mime;
  }

  displayThumb(item: Item): string | undefined {
    return item.e2ee ? this.store.get().plain[item.id]?.thumb : item.thumb;
  }

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
    const before = this.store.get().space;
    // Flip the switch right away; the server's `space` message confirms it.
    if (before) this.store.set({ space: { ...before, locked } });
    try {
      await this.socket.request({ t: 'room.lock', locked });
      this.toast(locked ? t.status.locked : t.status.unlocked);
    } catch (e) {
      if (before) this.store.set((s) => ({ space: s.space && { ...s.space, locked: !locked } }));
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

  // ───────────────────────── Wi-Fi resilience (§7.1) ─────────────────────────

  /** Read `#p=` once, keep it in sessionStorage, and remove it from the address bar. */
  static adoptPass() {
    const m = /[#&]p=([A-Za-z0-9_.-]+)/.exec(location.hash);
    if (!m) return;
    setSession('dz-pass', m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }

  leavePass() {
    setSession('dz-pass', null);
    this.store.set({ conn: 'connecting', items: [], peers: [] });
    this.socket.restart();
  }

  async createPass(): Promise<PassCreateAck | null> {
    try {
      return await this.socket.request<PassCreateAck>({ t: 'pass.create' }, { idempotent: false });
    } catch {
      return null;
    }
  }

  async find(code: string): Promise<boolean> {
    try {
      await this.socket.request({ t: 'find', code: code.trim().toUpperCase() });
      return true;
    } catch (e) {
      if (e instanceof RequestError && e.code === 'rate_limited') this.toast(t.moments.rateLimited);
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
