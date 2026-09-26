import { describe, expect, it } from 'vitest';
import { makePass, verifyPass } from '../src/tokens';
import { Client, cid, post } from './helpers';

describe('network passes', () => {
  it('verifies signature and expiry', async () => {
    const { pass } = await makePass('s', 'abcdefghijklmnopqrstuv');
    expect(await verifyPass('s', pass)).toBe('abcdefghijklmnopqrstuv');
    expect(await verifyPass('other', pass)).toBeNull();
    expect(await verifyPass('s', `${pass.slice(0, -2)}xx`)).toBeNull();
    const old = await makePass('s', 'abcdefghijklmnopqrstuv', Date.now() - 3 * 3600_000);
    expect(await verifyPass('s', old.pass)).toBeNull();
  });

  it('pairs a device on another IP by QR pass and by pair code', async () => {
    const home = await Client.open('scope=wifi', '198.51.100.1');
    await home.hello();
    const made = await home.request({ t: 'pass.create' });
    expect(made.ok).toBe(true);
    expect(made.data.code).toMatch(/^\d{6}$/);

    // QR: connect with the pass from a different IP.
    const phone = await Client.open(`scope=pass&id=${encodeURIComponent(made.data.pass)}`, '203.0.113.200');
    const st = await phone.hello();
    expect(st.space.viaPass).toBe(true);
    expect((await home.next((m) => m.t === 'peers')).peers).toHaveLength(2);

    // Pair code: single use.
    const j = await post('/v1/join', { code: made.data.code });
    expect(j.body.data).toEqual({ kind: 'pass', pass: made.data.pass });
    expect((await post('/v1/join', { code: made.data.code })).status).toBe(404);

    // A forged pass is refused.
    const bad = await Client.open(`scope=pass&id=${encodeURIComponent(`${made.data.pass}x`)}`);
    expect((await bad.waitClosed())?.code).toBe(4403);
  });
});

describe('busy networks', () => {
  it('turns on at 7 devices, hides others’ items, and finds by code', async () => {
    const ip = '198.51.100.77';
    const first = await Client.open('scope=wifi', ip);
    await first.hello();
    const id = cid();
    await first.request({ t: 'text.add', cid: id, body: 'from the first device' });

    const others: Client[] = [];
    for (let i = 0; i < 5; i++) {
      const c = await Client.open('scope=wifi', ip);
      await c.hello();
      others.push(c);
    }
    const seventh = await Client.open('scope=wifi', ip);
    const state = await seventh.hello();
    expect(state.space.busy).toBe(true);
    expect(state.peers).toEqual({ count: 7 });
    expect(state.items).toEqual([]);

    const firstState = await first.next((m) => m.t === 'state');
    expect(firstState.items.map((i: any) => i.id)).toEqual([id]); // your own items stay

    const code = firstState.items[0].code;
    const found = await seventh.request({ t: 'find', code: code.toLowerCase() });
    expect(found.data.item.id).toBe(id);
    expect((await seventh.request({ t: 'find', code: 'ZZZZ' })).error).toBe('not_found');

    // Direct transfer is off on busy networks.
    seventh.ws.send(JSON.stringify({ t: 'signal', to: 'x', data: { kind: 'bye' } }));
  });
});
