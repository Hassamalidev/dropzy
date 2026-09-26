import type { UploadInitAck, UploadUrlsAck } from '@dropzy/shared';
import type { SpaceSocket } from '../socket';

// Browser → R2 uploads (§9.3): one XHR PUT per part for progress events, 3 in parallel (2 on
// phones), each part retried up to 5× with backoff, paused while offline, URLs refreshed when
// they run low or get old, progress reported every 10 %.

/** Where the bytes come from: the plain file, or an encrypting reader (Private Share). */
export type Source = {
  size: number; // stored size
  slice(start: number, end: number): Promise<Blob>;
};

export type Progress = (loaded: number, total: number) => void;

export class UploadCancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

const URL_MAX_AGE = 50 * 60_000;
const MAX_TRIES = 5;

export async function runUpload(opts: {
  socket: SpaceSocket;
  init: UploadInitAck;
  source: Source;
  signal: AbortSignal;
  phone: boolean;
  onProgress: Progress;
}): Promise<void> {
  const { socket, init, source, signal } = opts;
  let lastPct = -10;
  let lastSent = 0;
  const report = (loaded: number) => {
    opts.onProgress(loaded, source.size);
    const pct = source.size ? Math.floor((loaded / source.size) * 100) : 100;
    if (pct >= lastPct + 10 || (Date.now() - lastSent > 5000 && pct > lastPct)) {
      lastPct = pct;
      lastSent = Date.now();
      socket.post({ t: 'upload.progress', id: init.id, pct });
    }
  };

  if (init.mode === 'single') {
    const body = await source.slice(0, source.size);
    await withRetries(signal, () => put(init.url, body, init.headers, signal, (l) => report(l)));
    report(source.size);
    await socket.request({ t: 'upload.complete', id: init.id });
    return;
  }

  const { partSize, partCount } = init;
  const urls = new Map<number, { url: string; at: number }>();
  for (const [n, url] of Object.entries(init.urls)) urls.set(Number(n), { url, at: Date.now() });
  const loaded = new Map<number, number>();
  const etags: { n: number; etag: string }[] = [];
  const total = () => {
    let s = 0;
    for (const v of loaded.values()) s += v;
    return s;
  };
  let next = 1;
  let fetching: Promise<void> | null = null;

  const refill = async (need: number) => {
    const now = Date.now();
    const want: number[] = [];
    for (let n = need; n <= partCount && want.length < 10; n++) {
      const u = urls.get(n);
      if (!u || now - u.at > URL_MAX_AGE) want.push(n);
    }
    if (!want.length) return;
    const r = await socket.request<UploadUrlsAck>({ t: 'upload.urls', id: init.id, parts: want });
    for (const [n, url] of Object.entries(r.urls)) urls.set(Number(n), { url, at: Date.now() });
  };

  const urlFor = async (n: number): Promise<string> => {
    const u = urls.get(n);
    const remaining = [...urls.keys()].filter((k) => k >= n).length;
    if (!u || Date.now() - u.at > URL_MAX_AGE || remaining < 3) {
      fetching ??= refill(n).finally(() => {
        fetching = null;
      });
      await fetching;
    }
    const got = urls.get(n);
    if (!got) throw new Error('no url');
    return got.url;
  };

  const worker = async () => {
    while (next <= partCount) {
      if (signal.aborted) throw new UploadCancelled();
      const n = next++;
      const start = (n - 1) * partSize;
      const end = Math.min(start + partSize, source.size);
      const body = await source.slice(start, end);
      const etag = await withRetries(signal, async () => {
        const url = await urlFor(n);
        return put(url, body, {}, signal, (l) => {
          loaded.set(n, l);
          report(total());
        });
      });
      loaded.set(n, end - start);
      report(total());
      urls.delete(n);
      etags.push({ n, etag });
    }
  };

  const lanes = Math.min(opts.phone ? 2 : 3, partCount);
  await Promise.all(Array.from({ length: lanes }, worker));
  etags.sort((a, b) => a.n - b.n);
  await socket.request({ t: 'upload.complete', id: init.id, parts: etags });
}

async function withRetries<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  let tries = 0;
  for (;;) {
    if (signal.aborted) throw new UploadCancelled();
    if (!navigator.onLine) {
      await waitOnline(signal);
      continue; // offline time never counts as a failed try
    }
    try {
      return await fn();
    } catch (err) {
      if (err instanceof UploadCancelled || signal.aborted) throw new UploadCancelled();
      if (!navigator.onLine) continue;
      if (++tries >= MAX_TRIES) throw err;
      await sleep(Math.min(16_000, 1000 * 2 ** (tries - 1)) * (0.8 + Math.random() * 0.4), signal);
    }
  }
}

export function waitOnline(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      removeEventListener('online', done);
      signal.removeEventListener('abort', stop);
      resolve();
    };
    const stop = () => {
      removeEventListener('online', done);
      reject(new UploadCancelled());
    };
    addEventListener('online', done);
    signal.addEventListener('abort', stop, { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new UploadCancelled());
      },
      { once: true },
    );
  });
}

/** PUT with XHR for upload progress. Resolves with the ETag (bucket CORS must expose it). */
function put(url: string, body: Blob, headers: Record<string, string>, signal: AbortSignal, onLoaded: (n: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.getResponseHeader('ETag') || '');
      else reject(new Error(`PUT ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('network'));
    xhr.ontimeout = () => reject(new Error('timeout'));
    const abort = () => {
      xhr.abort();
      reject(new UploadCancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.send(body);
  });
}
