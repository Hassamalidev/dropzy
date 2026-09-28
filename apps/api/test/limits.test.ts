import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const MiB = 1024 * 1024;
const GUARD = () => {
  const ns = (env as any).GUARD as DurableObjectNamespace;
  return ns.get(ns.idFromName('guard')) as any;
};

// wrangler.jsonc: 500 MB and 50 uploads per person (IP hash) per UTC day.
describe('daily upload allowance', () => {
  it('stops one person at 500 MB a day, but not someone else', async () => {
    expect(await GUARD().reserve('ip-a', 400 * MiB, 1)).toEqual({ ok: true });
    expect(await GUARD().reserve('ip-a', 150 * MiB, 1)).toEqual({ ok: false, error: 'daily_limit' });
    expect(await GUARD().reserve('ip-a', 100 * MiB, 1)).toEqual({ ok: true });
    expect(await GUARD().reserve('ip-b', 150 * MiB, 1)).toEqual({ ok: true });
  });

  it('stops one person after 50 uploads a day', async () => {
    for (let i = 0; i < 50; i++) expect((await GUARD().reserve('ip-c', 1, 1)).ok).toBe(true);
    expect(await GUARD().reserve('ip-c', 1, 1)).toEqual({ ok: false, error: 'daily_limit' });
  });

  it('keeps the count in storage, so a restart does not reset it', async () => {
    await GUARD().reserve('ip-d', 10 * MiB, 1);
    const row = await runInDurableObject(GUARD(), async (_i, state) =>
      (state.storage.sql as any).exec('SELECT bytes, files FROM ip_usage WHERE ip_hash = ?', 'ip-d').toArray()[0],
    );
    expect(row).toEqual({ bytes: 10 * MiB, files: 1 });
  });
});
