import { CLOSE, type HealthRes, fromB64url, isSearchCode, isSixDigits, isToken, randomToken, stripUnsafe } from '@dropzy/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { type Env, allowedOrigins, flag, maxCloudBytes, storageEnabled } from './env';
import { type Ctx, fail, getIpHash, isCapacityError, limited, ok } from './http';
import { clientIp, networkId, safeEqual } from './ip';
import { closeWith } from './space/SpaceDO';
import { verifyBlob } from './r2';
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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Content-Disposition, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  }
  await next();
  if (c.res.status === 101) return;
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(k, v);
  if (allowed) {
    c.res.headers.set('Access-Control-Allow-Origin', allowed);
    c.res.headers.set('Access-Control-Expose-Headers', 'ETag, Content-Length');
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
  headers.set('x-dz-origin', new URL(c.req.url).origin);
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
  const code = body?.code.trim().toUpperCase() ?? '';
  if (!isSixDigits(code) && !isSearchCode(code)) return fail(c, 'not_found', 404);
  try {
    const dir = c.env.DIRECTORY.get(c.env.DIRECTORY.idFromName('directory'));
    const r = await dir.lookup(code);
    if (!r.ok) return fail(c, r.error, r.error === 'locked' ? 423 : 404);
    if (r.kind === 'file') return ok(c, { kind: 'file', ref: r.ref });
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
    const r = await target.stub.fileDownload(target.itemId, new URL(c.req.url).origin);
    if ('error' in r) return fail(c, r.error, r.error === 'not_found' ? 404 : r.error === 'uploads_paused' ? 503 : 400);
    return ok(c, r);
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    return fail(c, 'not_found', 404);
  }
});

const KeyBody = z.strictObject({ pub: z.string().max(120).regex(/^[A-Za-z0-9_-]+$/) });

/** A Private Share file's key, sealed by a device still open in that share (see SpaceDO.relayKey). */
app.post('/v1/files/:ref/key', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_JOIN)) return fail(c, 'rate_limited', 429);
  const target = spaceForRef(c.env, c.req.param('ref'));
  const body = await readJson(c, KeyBody);
  if (!target || !body) return fail(c, 'not_found', 404);
  try {
    const r = await target.stub.relayKey(target.itemId, body.pub);
    if ('error' in r) return fail(c, r.error, r.error === 'sender_offline' ? 409 : 404);
    return ok(c, r);
  } catch (err) {
    if (isCapacityError(err)) return fail(c, 'at_capacity', 503);
    return fail(c, 'not_found', 404);
  }
});

// ───────────────────────── relayed file bytes (no R2 S3 keys) ─────────────────────────

app.put('/v1/blob/:token', async (c) => {
  const g = await verifyBlob(c.env.PASS_SECRET, c.req.param('token'));
  if (!g || g.m === 'get') return fail(c, 'forbidden', 403);
  const len = Number(c.req.header('Content-Length'));
  if (!Number.isFinite(len) || len <= 0 || len > g.max || !c.req.raw.body) return fail(c, 'bad_request', 400);
  const body = c.req.raw.body.pipeThrough(new FixedLengthStream(len));
  try {
    if (g.m === 'put') {
      const obj = await c.env.FILES.put(g.k, body, { httpMetadata: { contentType: g.ct, contentDisposition: g.cd } });
      return c.body(null, 200, { ETag: obj?.httpEtag ?? '' });
    }
    const part = await c.env.FILES.resumeMultipartUpload(g.k, g.u).uploadPart(g.n, body);
    return c.body(null, 200, { ETag: `"${part.etag}"` });
  } catch {
    return fail(c, 'bad_request', 400);
  }
});

app.get('/v1/blob/:token', async (c) => {
  const g = await verifyBlob(c.env.PASS_SECRET, c.req.param('token'));
  if (g?.m !== 'get') return fail(c, 'not_found', 404);
  const obj = await c.env.FILES.get(g.k);
  if (!obj) return fail(c, 'not_found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Content-Length', String(obj.size));
  headers.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers });
});

// ───────────────────────── reports & feedback (§14.7) ─────────────────────────

const admin = (env: Env) => env.ADMIN.get(env.ADMIN.idFromName('admin'));
const REASONS = ['illegal', 'malware', 'abuse', 'copyright', 'other'] as const;

const ReportBody = z.strictObject({
  ref: z.string().regex(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/),
  reason: z.enum(REASONS),
  note: z.string().max(1000).optional(),
});

app.post('/v1/report', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_PUBLIC)) return fail(c, 'rate_limited', 429);
  const body = await readJson(c, ReportBody);
  if (!body) return fail(c, 'bad_request', 400);
  const id = await admin(c.env).addReport({
    ref: body.ref,
    itemId: body.ref.split('.')[1],
    reason: body.reason,
    note: body.note ? stripUnsafe(body.note).trim() || undefined : undefined,
    ipHash: await getIpHash(c),
  });
  return id ? ok(c, { id }) : fail(c, 'rate_limited', 429);
});

const FeedbackBody = z.strictObject({
  type: z.enum(['feature', 'contact']),
  message: z.string().min(1).max(4000),
  email: z.string().email().max(254).optional(),
  website: z.string().max(200).optional(), // honeypot
});

app.post('/v1/feedback', async (c) => {
  if (!originOk(c)) return fail(c, 'forbidden', 403);
  if (await limited(c, c.env.RL_PUBLIC)) return fail(c, 'rate_limited', 429);
  const body = await readJson(c, FeedbackBody);
  if (!body || !body.message.trim()) return fail(c, 'bad_request', 400);
  // Bots fill the hidden field; pretend it worked.
  if (body.website) return ok(c, { id: randomToken(16) });
  const id = await admin(c.env).addFeedback({ type: body.type, message: stripUnsafe(body.message).trim(), email: body.email });
  return ok(c, { id });
});

// ───────────────────────── admin (§13, §14.7) ─────────────────────────

app.use('/v1/admin/*', async (c, next) => {
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!c.env.ADMIN_TOKEN || !token || !safeEqual(token, c.env.ADMIN_TOKEN)) return fail(c, 'forbidden', 403);
  await next();
});

app.get('/v1/admin/overview', async (c) => {
  const guard = c.env.GUARD.get(c.env.GUARD.idFromName('guard'));
  const [usage, lists] = await Promise.all([guard.report(), admin(c.env).overview()]);
  return ok(c, { usage, ...lists });
});

const ReportAction = z.strictObject({ action: z.enum(['delete', 'block24', 'block7d', 'dismiss']) });

app.post('/v1/admin/reports/:id', async (c) => {
  const body = await readJson(c, ReportAction);
  if (!body) return fail(c, 'bad_request', 400);
  const report = await admin(c.env).getReport(c.req.param('id'));
  if (!report) return fail(c, 'not_found', 404);
  const target = spaceForRef(c.env, report.ref);
  if (body.action === 'dismiss') {
    await admin(c.env).setStatus(report.id, 'dismissed');
    return ok(c, { status: 'dismissed' });
  }
  if (!target) return fail(c, 'not_found', 404);
  if (body.action === 'delete') {
    await target.stub.adminDelete(target.itemId);
    await admin(c.env).setStatus(report.id, 'deleted');
    return ok(c, { status: 'deleted' });
  }
  const ipHash = await target.stub.itemIpHash(target.itemId);
  if (!ipHash) return fail(c, 'not_found', 404);
  const days = body.action === 'block7d' ? 7 : 1;
  await c.env.GUARD.get(c.env.GUARD.idFromName('guard')).block(ipHash, Date.now() + days * 86_400_000);
  await target.stub.adminDelete(target.itemId);
  await admin(c.env).setStatus(report.id, 'blocked');
  return ok(c, { status: 'blocked' });
});

app.delete('/v1/admin/feedback/:id', async (c) => {
  await admin(c.env).deleteFeedback(c.req.param('id'));
  return ok(c, { id: c.req.param('id') });
});

app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));

app.onError((err, c) => {
  // Never log tokens, codes, IPs or names — only the error class and message.
  console.error('unhandled', err.name, err.message);
  return c.json({ ok: false, error: 'server_error' }, 500);
});

export default app;
