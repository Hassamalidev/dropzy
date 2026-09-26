import { b64, b64url, fromB64, fromB64url, randomBytes } from '@dropzy/shared';

// Private Share keys (§10). K lives only in the URL fragment and in memory — never in storage.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function newSpaceKey(): string {
  return b64url(randomBytes(32));
}

/** Read `#k=` from the fragment. Returns null when missing or malformed. */
export function keyFromHash(hash = location.hash): Uint8Array<ArrayBuffer> | null {
  const m = /[#&]k=([A-Za-z0-9_-]{43})/.exec(hash);
  if (!m) return null;
  try {
    const k = fromB64url(m[1]);
    return k.length === 32 ? k : null;
  } catch {
    return null;
  }
}

async function hkdfBits(ikm: Uint8Array<ArrayBuffer>, salt: string, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) },
    base,
    256,
  );
  return new Uint8Array(bits);
}

async function aesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** itemRoot = HKDF(K, salt = itemId, info = "dz1 item") */
export function itemRoot(K: Uint8Array<ArrayBuffer>, itemId: string) {
  return hkdfBits(K, itemId, 'dz1 item');
}
export async function contentKey(root: Uint8Array<ArrayBuffer>) {
  return aesKey(await hkdfBits(root, '', 'content'));
}
export async function metaKey(root: Uint8Array<ArrayBuffer>) {
  return aesKey(await hkdfBits(root, '', 'meta'));
}
async function textKey(K: Uint8Array<ArrayBuffer>, itemId: string) {
  return aesKey(await hkdfBits(K, itemId, 'dz1 text'));
}

/** AES-GCM with a random 12-byte IV → base64(iv ‖ ct). */
export async function sealBytes(key: CryptoKey, plain: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function openBytes(key: CryptoKey, sealed: string): Promise<Uint8Array<ArrayBuffer>> {
  const all = fromB64(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
  return new Uint8Array(pt);
}

export async function encryptText(K: Uint8Array<ArrayBuffer>, itemId: string, text: string): Promise<string> {
  return sealBytes(await textKey(K, itemId), enc.encode(text));
}

export async function decryptText(K: Uint8Array<ArrayBuffer>, itemId: string, body: string): Promise<string> {
  return dec.decode(await openBytes(await textKey(K, itemId), body));
}
