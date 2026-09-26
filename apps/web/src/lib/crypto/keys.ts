import { b64, b64url, fromB64, fromB64url, randomBytes } from '@dropzy/shared';

// Private Share keys (§10). K lives only in the URL fragment and in memory — never in storage.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function newSpaceKey(): string {
  return b64url(randomBytes(32));
}

// A Private Share link carries one 128-bit secret: /s#<22 chars>. Both the share's id (which the
// server sees) and K (which it never does) come from it, so the link needs nothing else.

export function newShareSecret(): string {
  return b64url(randomBytes(16));
}

/** Read the secret from a short link's fragment (`#<22 chars>`). Null for anything else. */
export function secretFromHash(hash = location.hash): string | null {
  const m = /^#([A-Za-z0-9_-]{22})$/.exec(hash);
  return m ? m[1] : null;
}

/** token = b64url(HKDF(S, "dz1 share", "id")), K = HKDF(S, "dz1 share", "key"). One-way: the token doesn't reveal S or K. */
export async function fromShareSecret(secret: string): Promise<{ token: string; key: Uint8Array<ArrayBuffer> }> {
  const s = fromB64url(secret);
  const [id, key] = await Promise.all([hkdfBits(s, 'dz1 share', 'id'), hkdfBits(s, 'dz1 share', 'key')]);
  return { token: b64url(id), key };
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

// ── Handing one file's key to a device that typed the file's code ──
// The asker makes a one-time ECDH P-256 key pair and sends only its public half. A device in the
// share seals itemRoot to it; the server relays public keys and a sealed box, never the key.

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export async function newRelayKeys(): Promise<{ keys: CryptoKeyPair; pub: string }> {
  const keys = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return { keys, pub: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))) };
}

async function relayKey(mine: CryptoKey, theirPub: string, itemId: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey('raw', fromB64url(theirPub), ECDH, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, mine, 256));
  return aesKey(await hkdfBits(shared, itemId, 'dz1 relay'));
}

/** Seal itemRoot to the asker's public key. Returns our public key and the sealed box. */
export async function sealRoot(root: Uint8Array<ArrayBuffer>, itemId: string, askerPub: string): Promise<{ pub: string; box: string }> {
  const { keys, pub } = await newRelayKeys();
  return { pub, box: await sealBytes(await relayKey(keys.privateKey, askerPub, itemId), root) };
}

export async function openRoot(keys: CryptoKeyPair, itemId: string, theirPub: string, box: string): Promise<Uint8Array<ArrayBuffer>> {
  const root = await openBytes(await relayKey(keys.privateKey, theirPub, itemId), box);
  if (root.length !== 32) throw new Error('bad key');
  return root;
}
