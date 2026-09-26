// Random identifiers and codes. Crypto randomness only, rejection sampling (§14.1).

export const SEARCH_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return b64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

export function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uniform random integer in [0, max) using rejection sampling. */
export function randomInt(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new RangeError('max');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/** 128-bit item id, 22 chars. */
export function randomId(): string {
  return randomToken(16);
}

export function randomDigits(n = 6): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String(randomInt(10));
  return s;
}

export function randomSearchCode(len = 4): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SEARCH_ALPHABET[randomInt(SEARCH_ALPHABET.length)];
  return s;
}

export const isSixDigits = (s: string) => /^\d{6}$/.test(s);
export const isSearchCode = (s: string) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(s);
export const isToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
export const isItemId = (s: string) => /^[A-Za-z0-9_-]{22}$/.test(s);
