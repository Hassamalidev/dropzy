import { b64url } from '@dropzy/shared';

// Raw IPs are never stored or logged (§7.1, §14.1). Only HMACs of them leave this file.

const keyCache = new Map<string, CryptoKey>();

async function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, k);
  }
  return k;
}

export async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export async function hmacVerify(secret: string, data: string, sig: Uint8Array<ArrayBuffer>): Promise<boolean> {
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify('HMAC', await hmacKey(secret), sig, new TextEncoder().encode(data));
}

/** IPv4 → the whole address; IPv6 → the first 64 bits. */
export function networkKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  head = groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g || '0', 16).toString(16))
    .join(':');
  return `${head}::/64`;
}

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || '127.0.0.1';
}

export async function networkId(secret: string, ip: string): Promise<string> {
  return b64url(await hmac(secret, `net|${networkKey(ip)}`)).slice(0, 22);
}

export async function ipHash(secret: string, ip: string): Promise<string> {
  return b64url(await hmac(secret, `ip|${ip}`)).slice(0, 22);
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
