// Where processed bytes go when saving (§9.5):
//  - Chromium desktop: showSaveFilePicker(), called synchronously inside the click, then streamed.
//  - Elsewhere: a temporary OPFS file written from a Worker, then an object-URL download.
//  - Last resort (no OPFS): memory.

export type Sink = {
  write(chunk: Uint8Array): Promise<void>;
  /** Finishes writing. OPFS and memory sinks return the File for an object-URL download. */
  close(): Promise<File | null>;
  abort(): Promise<void>;
};

type SaveHandle = { createWritable(): Promise<FileSystemWritableFileStream> };

export function canPick(): boolean {
  const ua = navigator.userAgent;
  return 'showSaveFilePicker' in window && !/Android|iPhone|iPad|Mobile/.test(ua);
}

/** Must be called synchronously inside the user's click, before any await. */
export function startPicker(name: string): Promise<SaveHandle> | null {
  if (!canPick()) return null;
  try {
    return (window as any).showSaveFilePicker({ suggestedName: name }) as Promise<SaveHandle>;
  } catch {
    return null;
  }
}

export async function pickerSink(handle: Promise<SaveHandle>): Promise<Sink> {
  const w = await (await handle).createWritable();
  return {
    write: (c) => w.write(c as Uint8Array<ArrayBuffer>),
    close: async () => {
      await w.close();
      return null;
    },
    abort: () => w.abort(),
  };
}

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory && typeof Worker !== 'undefined';
}

/** A file in OPFS under `path` (e.g. ['dz', 'tmp', id]). close() returns the File. */
export async function opfsSink(path: string[], name: string, type = ''): Promise<Sink> {
  const worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
  let n = 0;
  const waiting = new Map<number, [(v: any) => void, (e: Error) => void]>();
  worker.onmessage = (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w[0](e.data);
    else w[1](new Error(e.data.error));
  };
  const call = (msg: any, transfer: Transferable[] = []) =>
    new Promise<any>((resolve, reject) => {
      const id = ++n;
      waiting.set(id, [resolve, reject]);
      worker.postMessage({ ...msg, id }, transfer);
    });
  try {
    await call({ op: 'open', path });
  } catch (err) {
    worker.terminate();
    throw err;
  }
  return {
    async write(chunk) {
      const copy = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk.buffer : chunk.slice().buffer;
      await call({ op: 'write', data: copy }, [copy as ArrayBuffer]);
    },
    async close() {
      await call({ op: 'close' });
      worker.terminate();
      let d = await navigator.storage.getDirectory();
      for (const p of path.slice(0, -1)) d = await d.getDirectoryHandle(p);
      const f = await (await d.getFileHandle(path[path.length - 1])).getFile();
      return new File([f], name, { type: type || f.type });
    },
    async abort() {
      await call({ op: 'abort' }).catch(() => {});
      worker.terminate();
    },
  };
}

export function memorySink(name: string, type = ''): Sink {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  return {
    async write(c) {
      parts.push(c.slice());
    },
    async close() {
      return new File(parts, name, { type });
    },
    async abort() {
      parts.length = 0;
    },
  };
}

/** Pick the best sink. `picker` must come from startPicker() inside the click. */
export async function openSink(name: string, picker: Promise<SaveHandle> | null, tmpId: string, type = ''): Promise<Sink> {
  if (picker) {
    try {
      return await pickerSink(picker);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err; // the user cancelled the dialog
    }
  }
  if (hasOpfs()) {
    try {
      return await opfsSink(['dz', 'tmp', tmpId], name, type);
    } catch {
      // fall through
    }
  }
  return memorySink(name, type);
}

export async function pipeTo(stream: ReadableStream<Uint8Array>, sink: Sink, onBytes?: (n: number) => void): Promise<File | null> {
  const reader = stream.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await sink.write(value);
      total += value.length;
      onBytes?.(total);
    }
    return await sink.close();
  } catch (err) {
    await sink.abort();
    throw err;
  }
}

/** Download a File/Blob through an object URL. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  clickLink(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Let the browser's own download manager fetch a URL (no memory use). */
export function clickLink(href: string, name?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (name) a.download = name;
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Remove temporary OPFS files older than `maxAge` (§14.6). */
export async function cleanTmp(maxAge: number) {
  if (!hasOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dz = await root.getDirectoryHandle('dz', { create: true });
    const tmp = await dz.getDirectoryHandle('tmp', { create: true });
    const now = Date.now();
    for await (const [name, h] of (tmp as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
      if (h.kind !== 'file') continue;
      const f = await (h as FileSystemFileHandle).getFile();
      if (now - f.lastModified > maxAge) await tmp.removeEntry(name).catch(() => {});
    }
  } catch {}
}

/** Read a response body into a File, reporting progress against a known size. */
export async function readWithProgress(
  stream: ReadableStream<Uint8Array>,
  size: number,
  name: string,
  type: string | undefined,
  onPct: (pct: number) => void,
): Promise<File> {
  const reader = stream.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value as Uint8Array<ArrayBuffer>);
    got += value.length;
    onPct(size ? Math.min(100, Math.floor((got / size) * 100)) : 0);
  }
  return new File(parts, name, { type: type || '' });
}
