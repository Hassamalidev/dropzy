import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('health', () => {
  it('answers with feature flags', async () => {
    const res = await SELF.fetch('https://api.test/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.storage).toBe(false);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('only allows the site origin in CORS', async () => {
    const ok = await SELF.fetch('https://api.test/v1/health', { method: 'OPTIONS', headers: { Origin: 'http://localhost:4321' } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4321');
    const bad = await SELF.fetch('https://api.test/v1/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } });
    expect(bad.status).toBe(403);
  });
});
