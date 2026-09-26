import {
  DIRECT_CONNECT_TIMEOUT,
  DIRECT_FRAME,
  DIRECT_HIGH_WATER,
  DIRECT_LOW_WATER,
  DIRECT_STALL_TIMEOUT,
} from '@dropzy/shared';
import type { Sink } from '../sink';

// Data-channel protocol, one channel per file (§9.2):
//   sender → {"t":"meta",id,name,size,mime,thumb}
//   receiver → {"t":"accept"} | {"t":"decline",reason}
//   sender → 64 KiB binary frames (pause above 8 MiB buffered, resume at 1 MiB)
//   sender → {"t":"end"}; receiver checks the byte count → {"t":"ok"}
//   either side → {"t":"cancel"} at any time

export type Meta = { t: 'meta'; id: string; name: string; size: number; mime: string; thumb?: string };

export class DirectError extends Error {
  constructor(public reason: 'timeout' | 'declined' | 'stalled' | 'cancelled' | 'closed' | 'too_big' | 'no_space') {
    super(reason);
  }
}

function waitOpen(ch: RTCDataChannel, ms: number): Promise<void> {
  if (ch.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DirectError('timeout')), ms);
    ch.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ch.addEventListener('close', () => {
      clearTimeout(timer);
      reject(new DirectError('closed'));
    }, { once: true });
  });
}

/** Queue of control messages from the other side. */
function controlQueue(ch: RTCDataChannel) {
  const queue: any[] = [];
  let waiter: ((m: any) => void) | null = null;
  let closed = false;
  ch.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    let m: any;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(m);
    } else queue.push(m);
  });
  ch.addEventListener('close', () => {
    closed = true;
    waiter?.({ t: 'closed' });
  });
  return {
    next(ms: number): Promise<any> {
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve({ t: 'closed' });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new DirectError('stalled'));
        }, ms);
        waiter = (m) => {
          clearTimeout(timer);
          resolve(m);
        };
      });
    },
    peek: () => queue.find((m) => m.t === 'cancel'),
  };
}

export async function sendFile(
  ch: RTCDataChannel,
  file: Blob,
  meta: Meta,
  onProgress: (sent: number) => void,
  signal: AbortSignal,
): Promise<void> {
  ch.binaryType = 'arraybuffer';
  ch.bufferedAmountLowThreshold = DIRECT_LOW_WATER;
  await waitOpen(ch, DIRECT_CONNECT_TIMEOUT);
  const ctl = controlQueue(ch);
  const cancel = () => {
    try {
      ch.send(JSON.stringify({ t: 'cancel' }));
    } catch {}
    ch.close();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    ch.send(JSON.stringify(meta));
    const reply = await ctl.next(DIRECT_STALL_TIMEOUT);
    if (reply.t === 'decline') throw new DirectError(reply.reason === 'no_space' ? 'no_space' : reply.reason === 'too_big' ? 'too_big' : 'declined');
    if (reply.t !== 'accept') throw new DirectError('closed');

    const BLOCK = 1024 * 1024;
    let offset = 0;
    while (offset < meta.size) {
      if (signal.aborted) throw new DirectError('cancelled');
      if (ctl.peek()) throw new DirectError('cancelled');
      if (ch.readyState !== 'open') throw new DirectError('closed');
      const block = new Uint8Array(await file.slice(offset, offset + BLOCK).arrayBuffer());
      for (let i = 0; i < block.length; i += DIRECT_FRAME) {
        if (ch.bufferedAmount > DIRECT_HIGH_WATER) await drained(ch);
        ch.send(block.subarray(i, i + DIRECT_FRAME));
      }
      offset += block.length;
      onProgress(Math.max(0, offset - ch.bufferedAmount));
    }
    while (ch.bufferedAmount > 0 && ch.readyState === 'open') {
      await drained(ch, 0);
      onProgress(meta.size - ch.bufferedAmount);
    }
    ch.send(JSON.stringify({ t: 'end' }));
    const done = await ctl.next(DIRECT_STALL_TIMEOUT * 2);
    if (done.t !== 'ok') throw new DirectError(done.t === 'cancel' ? 'cancelled' : 'closed');
    onProgress(meta.size);
  } finally {
    signal.removeEventListener('abort', cancel);
    setTimeout(() => ch.close(), 1000);
  }
}

/** Wait until the send buffer drains below the threshold, or fail after 15 s without movement. */
function drained(ch: RTCDataChannel, threshold = DIRECT_LOW_WATER): Promise<void> {
  return new Promise((resolve, reject) => {
    let last = ch.bufferedAmount;
    const poll = setInterval(() => {
      if (ch.readyState !== 'open') return finish(new DirectError('closed'));
      if (ch.bufferedAmount <= threshold) return finish();
      if (ch.bufferedAmount < last) {
        last = ch.bufferedAmount;
        clearTimeout(stall);
        stall = setTimeout(() => finish(new DirectError('stalled')), DIRECT_STALL_TIMEOUT);
      }
    }, 100);
    let stall = setTimeout(() => finish(new DirectError('stalled')), DIRECT_STALL_TIMEOUT);
    const onLow = () => {
      if (ch.bufferedAmount <= threshold) finish();
    };
    ch.addEventListener('bufferedamountlow', onLow);
    function finish(err?: Error) {
      clearInterval(poll);
      clearTimeout(stall);
      ch.removeEventListener('bufferedamountlow', onLow);
      err ? reject(err) : resolve();
    }
  });
}

/**
 * Receive one file. `decide` checks size and free space and returns a sink, or a decline reason.
 * Resolves with whatever the sink produced on close.
 */
export function receiveFile(
  ch: RTCDataChannel,
  decide: (meta: Meta) => Promise<Sink | 'too_big' | 'no_space'>,
  onMeta: (meta: Meta) => void,
  onProgress: (received: number) => void,
): Promise<{ meta: Meta; file: File | null }> {
  ch.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    let meta: Meta | null = null;
    let sink: Sink | null = null;
    let received = 0;
    let chain: Promise<void> = Promise.resolve();
    let stall = 0;
    let finished = false;
    const kick = () => {
      clearTimeout(stall);
      stall = window.setTimeout(() => fail(new DirectError('stalled'), true), DIRECT_STALL_TIMEOUT);
    };
    const fail = (err: Error, tell = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(stall);
      if (tell) {
        try {
          ch.send(JSON.stringify({ t: 'cancel' }));
        } catch {}
      }
      void sink?.abort();
      ch.close();
      reject(err);
    };

    ch.onmessage = (e) => {
      if (finished) return;
      if (typeof e.data !== 'string') {
        if (!sink) return;
        const chunk = new Uint8Array(e.data as ArrayBuffer);
        received += chunk.length;
        const at = received;
        const s = sink;
        chain = chain.then(() => s.write(chunk)).then(() => onProgress(at));
        chain.catch((err) => fail(err, true));
        kick();
        return;
      }
      let m: any;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'meta' && !meta) {
        meta = m as Meta;
        onMeta(meta);
        decide(meta).then(
          (r) => {
            if (typeof r === 'string') {
              ch.send(JSON.stringify({ t: 'decline', reason: r }));
              fail(new DirectError(r));
              return;
            }
            sink = r;
            ch.send(JSON.stringify({ t: 'accept' }));
            kick();
          },
          (err) => fail(err, true),
        );
      } else if (m.t === 'end' && meta) {
        const m0 = meta;
        chain
          .then(async () => {
            if (received !== m0.size) throw new DirectError('closed');
            const file = (await sink?.close()) ?? null;
            ch.send(JSON.stringify({ t: 'ok' }));
            finished = true;
            clearTimeout(stall);
            setTimeout(() => ch.close(), 1000);
            resolve({ meta: m0, file });
          })
          .catch((err) => fail(err, true));
      } else if (m.t === 'cancel') {
        fail(new DirectError('cancelled'));
      }
    };
    ch.onclose = () => fail(new DirectError('closed'));
  });
}
