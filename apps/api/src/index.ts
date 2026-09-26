import { CLOSE, type HealthRes, fromB64url, isSixDigits, isToken, randomToken } from '@dropzy/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { type Env, allowedOrigins, flag, maxCloudBytes, storageEnabled } from './env';
import { type Ctx, fail, getIpHash, isCapacityError, limited, ok } from './http';
import { clientIp, networkId } from './ip';
import { closeWith } from './space/SpaceDO';
import { verifyPass } from './tokens';

export { SpaceDO } from './space/SpaceDO';
export { DirectoryDO } from './directory/DirectoryDO';
export { GuardDO } from './guard/GuardDO';
export { AdminDO } from './admin/AdminDO';

const app = new Hono<{ Bindings: Env; Variables: { ipHash: string } }>();

const SECURITY_HEADERS: Record<string, string> = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Cache-Control': 'no-store',
};

// CORS: only the site origin(s). Security headers on every response (§14.5).
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const allowed = origin && allowedOrigins(c.env).includes(origin) ? origin : null;
  if (c.req.method === 'OPTIONS') {
    if (!allowed) return c.body(null, 403);
    return c.body(null, 204, {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  }
  await next();
  if (c.res.status === 101) return;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  if (allowed) {
    c.res.headers.set('Access-Control-Allow-Origin', allowed);
    c.res.headers.append('Vary', 'Origin');
  }
});

// Browsers send Origin on cross-origin POSTs; anything else is refused (§8.1).
function originOk(c: Ctx): boolean {
  const origin = c.req.header('Origin');
  return !!origin && allowedOrigins(c.env).includes(origin);
}

async function readJson<T>(c: Ctx, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const text = await c.req.text();
    if (text.length > 16_384) return null;
    const r = schema.safeParse(text ? JSON.parse(text) : {});
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

app.get('/v1/health', (c) =>
  ok(c, {
    status: 'ok',
    storage: storageEnabled(c.env),
    turn: flag(c.env.TURN_ENABLED),
    maxCloudFileBytes: maxCloudBytes(c.env),
  } satisfies HealthRes),
);

// ───────────────────────── realtime ─────────────────────────

app.get('/v1/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return fail(c, 'bad_request', 400);
  if (!originOk(c)) return closeWith(CLOSE.FORBIDDEN, 'forbidden');
  if (await limited(c, c.env.RL_CONNECT)) return closeWith(CLOSE.RATE_LIMITED, 'rate_limited');
  if (c.req.query('v') !== '1') return closeWith(CLOSE.BAD_REQUEST, 'bad_request');

  const scope = c.req.query('scope');
  const id = c.req.query('id') || '';
  let name: string;
  let kind: 'net' | 'ses' | 'room';
  let viaPass = false;
  let net = '';
  if (scope === 'wifi') {
    net = await networkId(c.env.IP_HASH_SECRET, clientIp(c.req.raw));
    name = `net:${net}`;
    kind = 'net';
  } else if (scope === 'pass') {
    net = (await resolvePass(c.env, id)) ?? '';
    if (!net) return closeWith(CLOSE.FORBIDDEN, 'forbidden');
    name = `net:${net}`;
    kind = 'net';
    viaPass = true;
  } else if ((scope === 'ses' || scope === 'room') && isToken(id)) {
    name = `${scope}:${id}`;
    kind = scope;
  } else {
    return closeWith(CLOSE.BAD_REQUEST, 'bad_request');
  }

  const headers = new Headers(c.req.raw.headers);
  headers.set('x-dz-kind', kind);
  if (net) headers.set('x-dz-net', net);
  headers.set('x-dz-ip', await getIpHash(c));
  if (viaPass) headers.set('x-dz-via-pass', '1');
  try {
    const stub = c.env.SPACE.get(c.env.SPACE.idFromName(name));
    return await stub.fetch(new Request('https://space/ws', { headers }));
  } catch (err) {
    return closeWith(isCapacityError(err) ? CLOSE.AT_CAPACITY : CLOSE.BAD_REQUEST, 'unavailable');
  }
});

/** A network pass lets a device join a Wi-Fi space when detection misses (§7.1). */
function resolvePass(env: Env, pass: string): Promise<string | null> {
  return verifyPass(env.PASS_SECRET, pass);
}

// ───────────────────────── spaces ─────────────────────────

app.post('/v1/sessions', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_CREATE)) return fail(c, 'rate_limited', 429);
  try {
    const token = randomToken();
    const stub = c.env.SPACE.get(c.env.SPACE.idFromName(`ses:${token}`));
    const { expiresAt } = await stub.init('ses');
    return ok(c, { token, expiresAt });
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    throw err;
  }
});

app.post('/v1/rooms', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_CREATE)) return fail(c, 'rate_limited', 429);
  try {
    const token = randomToken();
    const dir = c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName('directory'));
    const provisional = Date.now() + 25 * 3600_000;
    const code = await dir.allocateRoom(token, provisional);
    const stub = c.env.SPACE.get(c.env.SPACE.idFromName(`room:${token}`));
    const { expiresAt } = await stub.init('room', code);
    await dir.updateRoom(code, { expiresAt });
    return ok(c, { token, code, expiresAt });
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    throw err;
  }
});

const JoinBody = z.strictObject({ code: z.string() });

app.post('/v1/join', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_JOIN)) return fail(c, 'rate_limited', 429);
  const body = await readJson(c, JoinBody);
  if (!body || !isSixDigits(body.code)) return fail(c, 'not_found', 404);
  try {
    const dir = c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName('directory'));
    const r = await dir.lookup(body.code);
    if (!r.ok) return fail(c, r.error, r.error === 'locked' ? 423 : 404);
    return ok(c, r.kind === 'room' ? { kind: 'room', token: r.token } : { kind: 'pass', pass: r.pass });
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    throw err;
  }
});

// ───────────────────────── TURN (optional, off by default) ─────────────────────────

app.get('/v1/ice', async (c) => {
  if (!flag(c.env.TURN_ENABLED) || !c.env.TURN_KEY_ID || !c.env.TURN_API_TOKEN) return fail(c, 'not_found', 404);
  if (await limited(c, c.env.RL_CONNECT)) return fail(c, 'rate_limited', 429);
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${c.env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 3600 }),
  });
  if (!res.ok) return fail(c, 'server_error', 500);
  const data = (await res.json()) as { iceServers: unknown };
  return ok(c, { iceServers: data.iceServers });
});

// ───────────────────────── single-file links (§9.4) ─────────────────────────

/** ref = base64url(DO id) + "." + itemId */
function spaceForRef(env: Env, ref: string) {
  const m = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/.exec(ref);
  if (!m) return null;
  try {
    const bytes = fromB64url(m[1]);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return { stub: env.SPACE.get(env.SPACE.idFromString(hex)), itemId: m[2] };
  } catch {
    return null;
  }
}

app.get('/v1/files/:ref', async (c) => {
  if (await limited(c, c.env.RL_PUBLIC)) return fail(c, 'rate_limited', 429);
  const target = spaceForRef(c.env, c.req.param('ref'));
  if (!target) return fail(c, 'not_found', 404);
  try {
    const meta = await target.stub.fileMeta(target.itemId);
    return meta ? ok(c, meta) : fail(c, 'not_found', 404);
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    return fail(c, 'not_found', 404);
  }
});

app.post('/v1/files/:ref/download', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_PUBLIC)) return fail(c, 'rate_limited', 429);
  const target = spaceForRef(c.env, c.req.param('ref'));
  if (!target) return fail(c, 'not_found', 404);
  try {
    const r = await target.stub.fileDownload(target.itemId);
    if ('error' in r) return fail(c, r.error, r.error === 'not_found' ? 404 : r.error === 'uploads_paused' ? 503 : 400);
    return ok(c, r);
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    return fail(c, 'not_found', 404);
  }
});

app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));

app.onError((err, c) => {
  // Never log tokens, codes, IPs or names — only the error class and message.
  console.error('unhandled', err.name, err.message);
  return c.json({ ok: false, error: 'server_error' }, 500);
});

export default app;
