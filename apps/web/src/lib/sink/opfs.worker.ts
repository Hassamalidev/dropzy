/// <reference lib="webworker" />
// Writes a stream of chunks into an OPFS file with a sync access handle, batching ~4 MiB writes
// (§9.2, §9.5). One worker per file.

type Msg =
  | { op: 'open'; id: number; path: string[] }
  | { op: 'write'; id: number; data: ArrayBuffer }
  | { op: 'close'; id: number }
  | { op: 'abort'; id: number };

const BATCH = 4 * 1024 * 1024;
let handle: FileSystemSyncAccessHandle | null = null;
let dir: FileSystemDirectoryHandle | null = null;
let fileName = '';
let pos = 0;
let pending: Uint8Array[] = [];
let pendingBytes = 0;

function flush() {
  if (!handle || !pendingBytes) return;
  const buf = new Uint8Array(pendingBytes);
  let o = 0;
  for (const p of pending) {
    buf.set(p, o);
    o += p.length;
  }
  pos += handle.write(buf, { at: pos });
  pending = [];
  pendingBytes = 0;
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  try {
    switch (m.op) {
      case 'open': {
        let d = await navigator.storage.getDirectory();
        for (const part of m.path.slice(0, -1)) d = await d.getDirectoryHandle(part, { create: true });
        dir = d;
        fileName = m.path[m.path.length - 1];
        const fh = await d.getFileHandle(fileName, { create: true });
        handle = await fh.createSyncAccessHandle();
        handle.truncate(0);
        pos = 0;
        break;
      }
      case 'write': {
        const chunk = new Uint8Array(m.data);
        pending.push(chunk);
        pendingBytes += chunk.length;
        if (pendingBytes >= BATCH) flush();
        break;
      }
      case 'close':
        flush();
        handle?.flush();
        handle?.close();
        handle = null;
        break;
      case 'abort':
        pending = [];
        pendingBytes = 0;
        handle?.close();
        handle = null;
        await dir?.removeEntry(fileName).catch(() => {});
        break;
    }
    self.postMessage({ id: m.id, ok: true, size: pos + pendingBytes });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err as Error)?.message || err) });
  }
};
