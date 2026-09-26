import type { Context } from 'hono';
import type { Env } from './env';
import { clientIp, ipHash } from './ip';

export type Ctx = Context<{ Bindings: Env; Variables: { ipHash: string } }>;

export async function getIpHash(c: Ctx): Promise<string> {
  let h = c.get('ipHash');
  if (!h) {
    h = await ipHash(c.env.IP_HASH_SECRET, clientIp(c.req.raw));
    c.set('ipHash', h);
  }
  return h;
}

export async function limited(c: Ctx, rl: RateLimit): Promise<boolean> {
  try {
    const { success } = await rl.limit({ key: await getIpHash(c) });
    return !success;
  } catch {
    return false; // the binding is best-effort
  }
}

export const fail = (c: Ctx, error: string, status: 400 | 403 | 404 | 409 | 410 | 413 | 423 | 429 | 500 | 503) =>
  c.json({ ok: false, error }, status);

export const ok = <T>(c: Ctx, data: T) => c.json({ ok: true, data });

/** Durable Object daily limits surface as thrown errors; report them as "at capacity" (§4.5). */
export function isCapacityError(err: unknown): boolean {
  const m = String((err as Error)?.message || '');
  return /exceeded|limit|overloaded|quota/i.test(m);
}
