import { PASS_TTL, b64url, fromB64url } from '@dropzy/shared';
import { hmac, hmacVerify } from './ip';

// Network passes (§7.1): base64url(JSON {v:1, n:networkId, exp}) + "." + base64url(HMAC-SHA256(PASS_SECRET, payload)).

export async function makePass(secret: string, networkId: string, now = Date.now()): Promise<{ pass: string; exp: number }> {
  const exp = now + PASS_TTL;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ v: 1, n: networkId, exp })));
  const sig = b64url(await hmac(secret, payload));
  return { pass: `${payload}.${sig}`, exp };
}

/** Returns the network id when the pass is authentic and unexpired. */
export async function verifyPass(secret: string, pass: string, now = Date.now()): Promise<string | null> {
  if (pass.length > 512) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(pass);
  if (!m) return null;
  try {
    if (!(await hmacVerify(secret, m[1], fromB64url(m[2])))) return null; // constant-time
    const body = JSON.parse(new TextDecoder().decode(fromB64url(m[1])));
    if (body?.v !== 1 || typeof body.n !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.n)) return null;
    if (typeof body.exp !== 'number' || body.exp <= now) return null;
    return body.n;
  } catch {
    return null;
  }
}
