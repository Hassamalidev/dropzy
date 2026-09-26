import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { storedSize } from '@dropzy/shared';
import { Client, ORIGIN, cid, post } from './helpers';

const FILES = () => (env as any).FILES as R2Bucket;
const GUARD = () => {
  const ns = (env as any).GUARD as DurableObjectNamespace;
  return ns.get(ns.idFromName('guard'));
};

async function room() {
  const { body } = await post('/v1/rooms');
  const q = `scope=room&id=${body.data.token}`;
  const a = await Client.open(q);
  const b = await Client.open(q);
  const sa = await a.hello();
  await b.hello();
  return { a, b, ref: sa.space.ref as string };
}

async function upload(a: Client, size: number, extra: Record<string, unknown> = {}) {
  const id = cid();
  const init = await a.request({ t: 'upload.init', cid: id, size, name: 'photo.jpg', mime: 'image/jpeg', e2ee: false, burn: false, ...extra });
  return { id, init };
}

describe('uploads', () => {
  it('hands a Private Share file key to a code holder only through a device in the share', async () => {
    const { body } = await post('/v1/sessions');
    const a = await Client.open(`scope=ses&id=${body.data.token}`);
    const ref = (await a.hello()).space.ref as string;
    const id = cid();
    const init = await a.request({ t: 'upload.init', cid: id, size: 10, encMeta: 'AAAA', e2ee: true, burn: false });
    expect(init.ok).toBe(true);
    const added = await a.next((m) => m.t === 'item.added' && m.item.id === id);
    await FILES().put(`f/${id}`, new Uint8Array(storedSize(10, true)));
    expect((await a.request({ t: 'upload.complete', id })).ok).toBe(true);

    // The code finds the file from anywhere…
    const found = await post('/v1/join', { code: added.item.code });
    expect(found.body.data).toEqual({ kind: 'file', ref: `${ref}.${id}` });

    // …and the key comes from the device in the share, sealed; the server only relays it.
    const asked = post(`/v1/files/${ref}.${id}/key`, { pub: 'asker-public-key' });
    const req = await a.next((m) => m.t === 'key.request');
    expect(req).toMatchObject({ id, pub: 'asker-public-key' });
    a.ws.send(JSON.stringify({ t: 'key.reply', req: req.req, pub: 'sharer-public-key', box: 'c2VhbGVk' }));
    expect((await asked).body.data).toEqual({ pub: 'sharer-public-key', box: 'c2VhbGVk' });

    // Nobody open in the share → it says so.
    a.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const offline = await post(`/v1/files/${ref}.${id}/key`, { pub: 'asker-public-key' });
    expect(offline.status).toBe(409);
    expect(offline.body.error).toBe('sender_offline');
  });

  it('gives each file a code that opens it from the Join page, until it is deleted', async () => {
    const { a, ref } = await room();
    const { id } = await upload(a, 10);
    const added = await a.next((m) => m.t === 'item.added' && m.item.id === id);
    const code = added.item.code as string;
    expect(code).toMatch(/^[23456789A-HJ-NP-Z]{4}$/);
    const found = await post('/v1/join', { code: code.toLowerCase() });
    expect(found.body.data).toEqual({ kind: 'file', ref: `${ref}.${id}` });
    expect((await a.request({ t: 'item.delete', id })).ok).toBe(true);
    expect((await post('/v1/join', { code })).status).toBe(404);
  });

  it('signs a single PUT, completes, and hands out download URLs', async () => {
    const { a, b, ref } = await room();
    const { id, init } = await upload(a, 1234);
    expect(init.ok).toBe(true);
    expect(init.data.mode).toBe('single');
    expect(init.data.url).toContain('https://testaccount.r2.cloudflarestorage.com/dropzy-files/f/');
    expect(init.data.url).toContain('X-Amz-Signature=');
    expect(init.data.headers).toEqual({
      'content-type': 'image/jpeg',
      'content-disposition': "attachment; filename*=UTF-8''photo.jpg",
    });
    const seen = await b.next((m) => m.t === 'item.added');
    expect(seen.item).toMatchObject({ id, status: 'uploading', name: 'photo.jpg', size: 1234 });

    // Completing before the bytes exist fails.
    expect((await a.request({ t: 'upload.complete', id })).ok).toBe(false);
    await FILES().put(`f/${id}`, new Uint8Array(1234));
    expect((await a.request({ t: 'upload.complete', id })).ok).toBe(true);
    const ready = await b.next((m) => m.t === 'item.updated' && m.item.status === 'ready');
    expect(ready.item.id).toBe(id);

    const dl = await b.request({ t: 'download.url', id });
    expect(dl.data.url).toContain('X-Amz-Expires=900');

    // Single-file page
    const meta = await SELF.fetch(`https://api.test/v1/files/${ref}.${id}`);
    expect(((await meta.json()) as any).data).toMatchObject({ name: 'photo.jpg', size: 1234, e2ee: false });
    const fdl = await SELF.fetch(`https://api.test/v1/files/${ref}.${id}/download`, { method: 'POST', headers: { Origin: ORIGIN } });
    expect(((await fdl.json()) as any).ok).toBe(true);

    // Deleting removes the object.
    expect((await a.request({ t: 'item.delete', id })).ok).toBe(true);
    expect(await FILES().head(`f/${id}`)).toBeNull();
  });

  it('deletes after the first download — but never for the uploader', async () => {
    const { a, b } = await room();
    const { id } = await upload(a, 10, { burn: true });
    await FILES().put(`f/${id}`, new Uint8Array(10));
    await a.request({ t: 'upload.complete', id });
    expect((await a.request({ t: 'download.url', id })).ok).toBe(true);
    expect((await a.request({ t: 'download.url', id })).ok).toBe(true);
    expect((await b.request({ t: 'download.url', id })).ok).toBe(true);
    expect(await a.next((m) => m.t === 'item.removed' && m.id === id)).toBeTruthy();
    expect(await b.request({ t: 'download.url', id })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('hands a one-download file to only one of two downloads at once', async () => {
    const { a, ref } = await room();
    const { id } = await upload(a, 10, { burn: true });
    await FILES().put(`f/${id}`, new Uint8Array(10));
    await a.request({ t: 'upload.complete', id });
    const dl = () => SELF.fetch(`https://api.test/v1/files/${ref}.${id}/download`, { method: 'POST', headers: { Origin: ORIGIN } });
    const res = await Promise.all([dl(), dl(), dl()]);
    const oks = (await Promise.all(res.map((r) => r.json() as Promise<any>))).filter((j) => j.ok);
    expect(oks.length).toBe(1);
  });

  it('refuses files over the upload limit', async () => {
    const { a } = await room();
    const { init } = await upload(a, 200 * 1024 * 1024);
    expect(init).toMatchObject({ ok: false, error: 'too_large' });
  });

  it('pauses uploads when a budget is spent', async () => {
    const { a, b } = await room();
    await (runInDurableObject as any)(GUARD(), async (_i: any, state: DurableObjectState) => {
      const day = new Date().toISOString().slice(0, 10);
      (state.storage.sql as any).exec(
        'INSERT OR REPLACE INTO usage (day, class_a, class_b, upload_bytes) VALUES (?, 30000, 0, 0)',
        day,
      );
    });
    const { init } = await upload(a, 10);
    expect(init).toMatchObject({ ok: false, error: 'uploads_paused' });
    const sp = await b.next((m) => m.t === 'space');
    expect(sp.space.uploads).toBe('paused');
    await (runInDurableObject as any)(GUARD(), async (_i: any, state: DurableObjectState) => {
      (state.storage.sql as any).exec('DELETE FROM usage');
    });
  });

  it('releases the reservation when an upload is cancelled', async () => {
    const { a, b } = await room();
    const { id } = await upload(a, 5000);
    expect((await a.request({ t: 'upload.abort', id })).ok).toBe(true);
    expect(await b.next((m) => m.t === 'item.removed' && m.id === id)).toBeTruthy();
    const reserved = await (runInDurableObject as any)(GUARD(), async (_i: any, state: DurableObjectState) =>
      (state.storage.sql as any).exec('SELECT reserved_bytes AS r FROM storage').one().r,
    );
    expect(reserved).toBe(0);
  });
});
