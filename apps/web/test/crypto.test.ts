import { E2EE_CHUNK, E2EE_TAG, partSizeFor, storedSize } from '@dropzy/shared';
import { describe, expect, it } from 'vitest';
import { decryptStream, encryptedSource, fileKeys, openMeta, sealMeta } from '../src/lib/crypto/files';
import { decryptText, encryptText, itemRoot, newRelayKeys, openRoot, sealRoot } from '../src/lib/crypto/keys';

const K = crypto.getRandomValues(new Uint8Array(32));

function same(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
const ID = 'AAAAAAAAAAAAAAAAAAAAAA';

async function roundTrip(size: number, part = partSizeFor(storedSize(size, true), true)) {
  const plain = crypto.getRandomValues(new Uint8Array(Math.min(size, 65536)));
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i += plain.length) data.set(plain.subarray(0, Math.min(plain.length, size - i)), i);
  const { content } = await fileKeys(await itemRoot(K, ID));
  const src = encryptedSource(new Blob([data]), ID, content);
  expect(src.size).toBe(storedSize(size, true));
  const parts: Blob[] = [];
  for (let o = 0; o < src.size; o += part) parts.push(await src.slice(o, Math.min(o + part, src.size)));
  const stored = new Uint8Array(await new Blob(parts).arrayBuffer());
  expect(stored.length).toBe(src.size);
  const out = await new Response(new Blob([stored]).stream().pipeThrough(decryptStream(ID, content, size))).arrayBuffer();
  expect(same(new Uint8Array(out), data)).toBe(true);
  return { stored, content };
}

describe('end-to-end encryption', () => {
  it('round-trips empty, small and multi-chunk files across part boundaries', async () => {
    await roundTrip(0);
    await roundTrip(10);
    await roundTrip(E2EE_CHUNK);
    await roundTrip(3 * E2EE_CHUNK + 5, 2 * (E2EE_CHUNK + E2EE_TAG));
  });

  it('detects tampering and truncation', async () => {
    const size = 2 * E2EE_CHUNK + 7;
    const { stored, content } = await roundTrip(size);
    const bad = stored.slice();
    bad[100] ^= 1;
    await expect(new Response(new Blob([bad]).stream().pipeThrough(decryptStream(ID, content, size))).arrayBuffer()).rejects.toThrow();
    const cut = stored.slice(0, E2EE_CHUNK + E2EE_TAG);
    await expect(new Response(new Blob([cut]).stream().pipeThrough(decryptStream(ID, content, size))).arrayBuffer()).rejects.toThrow();
  });

  it('stops reordered chunks', async () => {
    const size = 2 * E2EE_CHUNK;
    const { stored, content } = await roundTrip(size);
    const c = E2EE_CHUNK + E2EE_TAG;
    const swapped = new Uint8Array(stored.length);
    swapped.set(stored.subarray(c, 2 * c), 0);
    swapped.set(stored.subarray(0, c), c);
    await expect(new Response(new Blob([swapped]).stream().pipeThrough(decryptStream(ID, content, size))).arrayBuffer()).rejects.toThrow();
  });

  it('seals metadata and text', async () => {
    const { meta } = await fileKeys(await itemRoot(K, ID));
    const sealed = await sealMeta(meta, { name: 'secret.pdf', mime: 'application/pdf' });
    expect(sealed).not.toContain('secret');
    expect(await openMeta(meta, sealed)).toEqual({ name: 'secret.pdf', mime: 'application/pdf' });
    const body = await encryptText(K, ID, 'hello');
    expect(await decryptText(K, ID, body)).toBe('hello');
    await expect(decryptText(K, 'BBBBBBBBBBBBBBBBBBBBBB', body)).rejects.toThrow();
  });
});

describe('file key relay (file codes)', () => {
  const ID = 'AAAAAAAAAAAAAAAAAAAAAA';

  it('only the asking device can open the sealed key', async () => {
    const root = await itemRoot(K, ID);
    const asker = await newRelayKeys();
    const { pub, box } = await sealRoot(root, ID, asker.pub);
    expect(same(await openRoot(asker.keys, ID, pub, box), root)).toBe(true);

    const other = await newRelayKeys();
    await expect(openRoot(other.keys, ID, pub, box)).rejects.toThrow();
    await expect(openRoot(asker.keys, 'BBBBBBBBBBBBBBBBBBBBBB', pub, box)).rejects.toThrow();
  });
});
