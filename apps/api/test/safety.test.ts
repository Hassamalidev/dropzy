import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Client, ORIGIN, cid, post } from './helpers';

const adminGet = (path: string, token = 'test-admin-token') =>
  SELF.fetch(`https://api.test${path}`, { headers: { Authorization: `Bearer ${token}`, Origin: ORIGIN } });

describe('feedback', () => {
  it('stores feedback and quietly drops honeypot hits', async () => {
    expect((await post('/v1/feedback', { type: 'feature', message: 'Folder upload please' })).body.ok).toBe(true);
    expect((await post('/v1/feedback', { type: 'feature', message: 'spam', website: 'http://x' })).body.ok).toBe(true);
    const o = (await (await adminGet('/v1/admin/overview')).json()) as any;
    const msgs = o.data.feedback.map((f: any) => f.message);
    expect(msgs).toContain('Folder upload please');
    expect(msgs).not.toContain('spam');
  });

  it('rejects unknown fields and bad input', async () => {
    expect((await post('/v1/feedback', { type: 'feature', message: 'x', extra: 1 })).status).toBe(400);
    expect((await post('/v1/feedback', { type: 'nope', message: 'x' })).status).toBe(400);
    expect((await post('/v1/report', { ref: 'short', reason: 'illegal' })).status).toBe(400);
  });

  it('refuses requests from other origins', async () => {
    const r = await post('/v1/feedback', { type: 'feature', message: 'x' }, { Origin: 'https://evil.test' });
    expect(r.status).toBe(403);
  });
});

describe('admin', () => {
  it('needs the admin token', async () => {
    expect((await adminGet('/v1/admin/overview', 'wrong')).status).toBe(403);
    expect((await SELF.fetch('https://api.test/v1/admin/overview')).status).toBe(403);
    expect((await adminGet('/v1/admin/overview')).status).toBe(200);
  });

  it('deletes a reported item and blocks its uploader', async () => {
    const { body } = await post('/v1/rooms');
    const q = `scope=room&id=${body.data.token}`;
    const up = await Client.open(q, '192.0.2.200');
    const other = await Client.open(q, '192.0.2.201');
    const st = await up.hello();
    await other.hello();
    const id = cid();
    await up.request({ t: 'upload.init', cid: id, size: 3, name: 'bad.txt', mime: 'text/plain', e2ee: false, burn: false });
    await (env as any).FILES.put(`f/${id}`, new Uint8Array(3));
    await up.request({ t: 'upload.complete', id });

    const ref = `${st.space.ref}.${id}`;
    const rep = await post('/v1/report', { ref, reason: 'malware', note: 'scam' });
    expect(rep.body.ok).toBe(true);
    const o = (await (await adminGet('/v1/admin/overview')).json()) as any;
    const report = o.data.reports.find((r: any) => r.item_id === id);
    expect(report).toMatchObject({ reason: 'malware', note: 'scam', status: 'open' });

    const act = await SELF.fetch(`https://api.test/v1/admin/reports/${report.id}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ action: 'block24' }),
    });
    expect(((await act.json()) as any).data.status).toBe('blocked');
    expect(await other.next((m) => m.t === 'item.removed' && m.id === id)).toBeTruthy();

    // The blocked uploader can't upload again.
    const again = await up.request({ t: 'upload.init', cid: cid(), size: 3, name: 'x.txt', e2ee: false, burn: false });
    expect(again).toMatchObject({ ok: false, error: 'forbidden' });
  });
});
