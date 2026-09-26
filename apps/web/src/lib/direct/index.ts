import { DIRECT_FILE_TTL, IOS_DIRECT_CAP, type Peer, type SignalData } from '@dropzy/shared';
import { api } from '../api';
import { hasOpfs, opfsSink } from '../sink';
import { DirectError, type Meta, receiveFile, sendFile } from './channel';
import { PeerConn, STUN } from './peer';

// Browser-to-browser transfer (§9.2). Loaded on demand.

export { DirectError };

export type Received = { id: string; name: string; mime: string; size: number; from: string; at: number };

export interface DirectHost {
  me(): string | null;
  signal(to: string, data: SignalData): void;
  peerName(peerId: string): string;
  maxDirectBytes(): number;
  onIncoming(meta: Meta, from: string): void;
  onIncomingProgress(id: string, received: number): void;
  onReceived(r: Received, file: File): void;
  onIncomingFailed(id: string, err: DirectError): void;
}

const REG = 'dz-recv';

export function registry(): Record<string, Received> {
  try {
    return JSON.parse(localStorage.getItem(REG) || '{}');
  } catch {
    return {};
  }
}
function saveRegistry(r: Record<string, Received>) {
  try {
    localStorage.setItem(REG, JSON.stringify(r));
  } catch {}
}

export class Direct {
  private conns = new Map<string, PeerConn>();
  private ice: Promise<RTCIceServer[]> | null = null;

  constructor(private host: DirectHost) {}

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && hasOpfs();
  }

  /** Free storage − 10 %, capped at 1 GiB on iPhone/iPad (§9.2). */
  static async maxBytes(ios: boolean): Promise<number> {
    if (!Direct.supported()) return 0;
    let free = Number.MAX_SAFE_INTEGER;
    try {
      const e = await navigator.storage.estimate();
      if (e.quota) free = Math.max(0, (e.quota - (e.usage ?? 0)) * 0.9);
    } catch {}
    return Math.floor(ios ? Math.min(free, IOS_DIRECT_CAP) : free);
  }

  private iceServers(): Promise<RTCIceServer[]> {
    this.ice ??=
      import.meta.env.PUBLIC_TURN_ENABLED === 'true'
        ? api
            .ice()
            .then((r) => [...STUN, ...r.iceServers])
            .catch(() => STUN)
        : Promise.resolve(STUN);
    return this.ice;
  }

  private async conn(peerId: string): Promise<PeerConn> {
    // Await first: nothing may run between the map check and set, or two sends to one peer
    // started together would each build their own connection.
    const ice = await this.iceServers();
    const have = this.conns.get(peerId);
    if (have && !have.closed) return have;
    const me = this.host.me();
    if (!me) throw new DirectError('closed');
    const c = new PeerConn(peerId, me, (d) => this.host.signal(peerId, d), ice);
    c.onChannel = (ch) => this.incoming(ch, peerId);
    c.onClose = () => {
      if (this.conns.get(peerId) === c) this.conns.delete(peerId);
    };
    this.conns.set(peerId, c);
    return c;
  }

  async onSignal(from: string, data: SignalData) {
    try {
      if (data.kind === 'bye') {
        this.conns.get(from)?.close(false);
        return;
      }
      await (await this.conn(from)).onSignal(data);
    } catch {
      // a failed negotiation surfaces as a connect timeout on the sender
    }
  }

  /** Send one file to one peer. Throws DirectError on timeout, decline, stall or cancel. */
  async send(peer: Peer, file: File, id: string, thumb: string | undefined, onProgress: (n: number) => void, signal: AbortSignal) {
    const c = await this.conn(peer.peerId);
    const ch = c.channel(`file-${id}`);
    const meta: Meta = { t: 'meta', id, name: file.name, size: file.size, mime: file.type || 'application/octet-stream', thumb };
    await sendFile(ch, file, meta, onProgress, signal);
  }

  private incoming(ch: RTCDataChannel, from: string) {
    if (!ch.label.startsWith('file-')) return;
    let id = '';
    receiveFile(
      ch,
      async (meta) => {
        if (meta.size > this.host.maxDirectBytes()) return 'too_big';
        try {
          const e = await navigator.storage.estimate();
          if (e.quota && meta.size > (e.quota - (e.usage ?? 0)) * 0.9) return 'no_space';
        } catch {}
        return opfsSink(['dz', 'recv', meta.id], meta.name, meta.mime);
      },
      (meta) => {
        id = meta.id;
        this.host.onIncoming(meta, from);
      },
      (n) => this.host.onIncomingProgress(id, n),
    ).then(
      ({ meta, file }) => {
        if (!file) return;
        const r: Received = { id: meta.id, name: meta.name, mime: meta.mime, size: meta.size, from: this.host.peerName(from), at: Date.now() };
        const reg = registry();
        reg[r.id] = r;
        saveRegistry(reg);
        this.host.onReceived(r, file);
      },
      (err) => id && this.host.onIncomingFailed(id, err instanceof DirectError ? err : new DirectError('closed')),
    );
  }

  closeAll() {
    for (const c of this.conns.values()) c.close(true);
    this.conns.clear();
  }
}

/** Received files still in OPFS from an earlier visit, newest first (§9.2). */
export async function recoverReceived(): Promise<{ r: Received; file: File }[]> {
  const reg = registry();
  const out: { r: Received; file: File }[] = [];
  if (!hasOpfs()) return out;
  const now = Date.now();
  let dir: FileSystemDirectoryHandle;
  try {
    const root = await navigator.storage.getDirectory();
    dir = await (await root.getDirectoryHandle('dz', { create: true })).getDirectoryHandle('recv', { create: true });
  } catch {
    return out;
  }
  for (const [id, r] of Object.entries(reg)) {
    try {
      if (now - r.at > DIRECT_FILE_TTL) throw new Error('old');
      const f = await (await dir.getFileHandle(id)).getFile();
      out.push({ r, file: new File([f], r.name, { type: r.mime }) });
    } catch {
      delete reg[id];
      await dir.removeEntry(id).catch(() => {});
    }
  }
  // Remove stray files with no registry entry.
  try {
    for await (const [name] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (!reg[name]) await dir.removeEntry(name).catch(() => {});
    }
  } catch {}
  saveRegistry(reg);
  return out.sort((a, b) => b.r.at - a.r.at);
}

/** Forget a received file once saved; the bytes go a minute later so the download can finish. */
export function forgetReceived(id: string) {
  const reg = registry();
  delete reg[id];
  saveRegistry(reg);
  setTimeout(async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('dz')).getDirectoryHandle('recv');
      await dir.removeEntry(id);
    } catch {}
  }, 60_000);
}
