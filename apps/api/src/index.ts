import type { HealthRes } from '@dropzy/shared';
import { Hono } from 'hono';
import { type Env, allowedOrigins, flag, maxCloudBytes, storageEnabled } from './env';

export { SpaceDO } from './space/SpaceDO';
export { DirectoryDO } from './directory/DirectoryDO';
export { GuardDO } from './guard/GuardDO';
export { AdminDO } from './admin/AdminDO';

const app = new Hono<{ Bindings: Env }>();

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

app.get('/v1/health', (c) =>
  c.json({
    ok: true,
    data: {
      status: 'ok',
      storage: storageEnabled(c.env),
      turn: flag(c.env.TURN_ENABLED),
      maxCloudFileBytes: maxCloudBytes(c.env),
    } satisfies HealthRes,
  }),
);

app.notFound((c) => c.json({ ok: false, error: 'not_found' }, 404));

app.onError((err, c) => {
  // Never log tokens, codes, IPs or names — only the error class and message.
  console.error('unhandled', err.name, err.message);
  return c.json({ ok: false, error: 'server_error' }, 500);
});

export default app;
