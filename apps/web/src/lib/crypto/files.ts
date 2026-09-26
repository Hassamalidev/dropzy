import { E2EE_CHUNK, E2EE_TAG, b64, e2eeChunks, fromB64, storedSize } from '@dropzy/shared';
import type { Source } from '../upload/uploader';
import { contentKey, metaKey, openBytes, sealBytes } from './keys';

// File encryption for Private Share (§10):
//  1 MiB plaintext chunks; chunk i → AES-256-GCM, nonce = 8 zero bytes ‖ uint32-BE(i),
//  AAD = "dz1|" + itemId + "|" + i + "|" + (last ? 1 : 0), which stops reordering and truncation.
//  Each encrypted chunk is 16 bytes longer; a 0-byte file is one empty chunk.

const ENC = E2EE_CHUNK + E2EE_TAG;
const enc = new TextEncoder();
const dec = new TextDecoder();

export async function fileKeys(root: Uint8Array<ArrayBuffer>) {
  return { content: await contentKey(root), meta: await metaKey(root) };
}

function nonce(i: number): Uint8Array<ArrayBuffer> {
  const n = new Uint8Array(12);
  new DataView(n.buffer).setUint32(8, i, false);
  return n;
}

function aad(itemId: string, i: number, last: boolean): Uint8Array<ArrayBuffer> {
  return enc.encode(`dz1|${itemId}|${i}|${last ? 1 : 0}`);
}

async function encryptChunk(key: CryptoKey, itemId: string, i: number, last: boolean, plain: Uint8Array<ArrayBuffer>) {
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: aad(itemId, i, last) }, key, plain);
  return new Uint8Array(ct);
}

async function decryptChunk(key: CryptoKey, itemId: string, i: number, last: boolean, ct: Uint8Array<ArrayBuffer>) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(i), additionalData: aad(itemId, i, last) }, key, ct);
  return new Uint8Array(pt);
}

/**
 * An upload source that encrypts on the fly. Part boundaries are multiples of the encrypted chunk
 * size (sizes.partSizeFor), so every slice starts on a chunk.
 */
export function encryptedSource(file: Blob, itemId: string, key: CryptoKey): Source {
  const n = e2eeChunks(file.size);
  return {
    size: storedSize(file.size, true),
    async slice(start, end) {
      if (start % ENC !== 0) throw new Error('unaligned slice');
      const first = start / ENC;
      const lastIdx = Math.min(n - 1, Math.ceil(end / ENC) - 1);
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let i = first; i <= lastIdx; i++) {
        const plain = new Uint8Array(await file.slice(i * E2EE_CHUNK, Math.min(file.size, (i + 1) * E2EE_CHUNK)).arrayBuffer());
        parts.push(await encryptChunk(key, itemId, i, i === n - 1, plain));
      }
      return new Blob(parts);
    },
  };
}

/** Decrypts a stored stream back to plaintext; errors on tampering, reordering or truncation. */
export function decryptStream(itemId: string, key: CryptoKey, plainSize: number): TransformStream<Uint8Array, Uint8Array> {
  const n = e2eeChunks(plainSize);
  // Incoming pieces are gathered and copied once per encrypted chunk (not per network read).
  let pieces: Uint8Array[] = [];
  let have = 0;
  let i = 0;
  const need = (idx: number) => Math.min(E2EE_CHUNK, plainSize - idx * E2EE_CHUNK) + E2EE_TAG;
  const take = (len: number): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(len);
    let o = 0;
    while (o < len) {
      const p = pieces[0];
      const k = Math.min(p.length, len - o);
      out.set(p.subarray(0, k), o);
      o += k;
      if (k === p.length) pieces.shift();
      else pieces[0] = p.subarray(k);
    }
    have -= len;
    return out;
  };
  return new TransformStream({
    async transform(chunk, ctl) {
      pieces.push(chunk);
      have += chunk.length;
      while (i < n && have >= need(i)) {
        ctl.enqueue(await decryptChunk(key, itemId, i, i === n - 1, take(need(i))));
        i++;
      }
      if (i >= n && have) throw new Error('trailing data');
    },
    flush() {
      if (i !== n || have) throw new Error('truncated');
      pieces = [];
    },
  });
}

export async function sealMeta(key: CryptoKey, meta: { name: string; mime: string }): Promise<string> {
  return sealBytes(key, enc.encode(JSON.stringify(meta)));
}

export async function openMeta(key: CryptoKey, sealed: string): Promise<{ name: string; mime: string }> {
  const m = JSON.parse(dec.decode(await openBytes(key, sealed)));
  return { name: String(m.name ?? 'file'), mime: String(m.mime ?? '') };
}

/** Thumbnails are data URLs; sealed as bytes. */
export async function sealThumb(key: CryptoKey, dataUrl: string): Promise<string> {
  return sealBytes(key, enc.encode(dataUrl));
}

export async function openThumb(key: CryptoKey, sealed: string): Promise<string | undefined> {
  const s = dec.decode(await openBytes(key, sealed));
  return /^data:image\/(webp|jpeg|png);base64,/.test(s) ? s : undefined;
}

export { b64, fromB64 };
