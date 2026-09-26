import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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
