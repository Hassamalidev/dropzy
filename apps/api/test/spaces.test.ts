import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { Client, cid, post } from './helpers';

describe('private share', () => {
  it('creates a session and shares text between two devices', async () => {
    const { body } = await post('/v1/sessions');
    expect(body.ok).toBe(true);
    const { token } = body.data;

    const a = await Client.open(`scope=ses&id=${token}`);
    const b = await Client.open(`scope=ses&id=${token}`);
    const sa = await a.hello(undefined, 'Blue Fox');
    expect(sa.space.kind).toBe('ses');
    expect(sa.items).toEqual([]);
    await b.hello(undefined, 'Red Cat');
    const peers = await a.next((m) => m.t === 'peers');
    expect(peers.peers).toHaveLength(2);

    const id = cid();
    const ack = await a.request({ t: 'text.add', cid: id, body: 'aGVsbG8=' });
    expect(ack.ok).toBe(true);
    const added = await b.next((m) => m.t === 'item.added');
    expect(added.item).toMatchObject({ id, type: 'text', body: 'aGVsbG8=', mine: false, e2ee: true });

    // Retrying the same cid never duplicates.
    const again = await a.request({ t: 'text.add', cid: id, body: 'aGVsbG8=' });
    expect(again.ok).toBe(true);
    const c = await Client.open(`scope=ses&id=${token}`);
    const sc = await c.hello();
    expect(sc.items).toHaveLength(1);

    // Anyone in a private share may delete.
    const del = await b.request({ t: 'item.delete', id });
    expect(del.ok).toBe(true);
    expect(await a.next((m) => m.t === 'item.removed')).toMatchObject({ id });
  });

  it('extends up to the maximum', async () => {
    const { body } = await post('/v1/sessions');
    const a = await Client.open(`scope=ses&id=${body.data.token}`);
    await a.hello();
    const r1 = await a.request({ t: 'space.extend' });
    expect(r1.ok).toBe(true);
    await a.request({ t: 'space.extend' });
    const r3 = await a.request({ t: 'space.extend' });
    expect(r3).toMatchObject({ ok: false, error: 'max_length' });
  });

  it('rejects unknown tokens with 4404', async () => {
    const a = await Client.open(`scope=ses&id=${'x'.repeat(43)}`);
    expect((await a.waitClosed())?.code).toBe(4404);
  });

  it('ends the share at expiry', async () => {
    const { body } = await post('/v1/sessions');
    const a = await Client.open(`scope=ses&id=${body.data.token}`);
    await a.hello();
    const ns = (env as any).SPACE as DurableObjectNamespace;
    const stub = ns.get(ns.idFromName(`ses:${body.data.token}`));
    await (runInDurableObject as any)(stub, (instance: any, state: DurableObjectState) => {
      (state.storage.sql as any).exec('UPDATE space SET expires_at = ?', Date.now() - 1);
      instance.spaceCache = undefined;
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const ended = await a.next((m) => m.t === 'ended').catch(() => null);
    expect(ended ?? (await a.waitClosed())).toBeTruthy();
  });
});

describe('rooms', () => {
  it('joins by code, locks, and keeps members', async () => {
    const { body } = await post('/v1/rooms');
    const { token, code } = body.data;
    expect(code).toMatch(/^\d{6}$/);

    const join = await post('/v1/join', { code });
    expect(join.body.data).toEqual({ kind: 'room', token });

    const memberId = crypto.randomUUID();
    const a = await Client.open(`scope=room&id=${token}`);
    const s = await a.hello(memberId);
    expect(s.space).toMatchObject({ kind: 'room', code, locked: false });

    expect((await a.request({ t: 'room.lock', locked: true })).ok).toBe(true);
    expect((await a.next((m) => m.t === 'space')).space.locked).toBe(true);

    const locked = await post('/v1/join', { code });
    expect(locked.status).toBe(423);
    expect(locked.body.error).toBe('locked');

    // A new device is refused by link too…
    const b = await Client.open(`scope=room&id=${token}`);
    b.ws.send(JSON.stringify({ t: 'hello', rid: 'h', deviceId: crypto.randomUUID(), name: 'X', type: 'mac', caps: { direct: false, maxDirectBytes: 0 } }));
    expect((await b.waitClosed())?.reason).toBe('locked');

    // …but someone already inside can come back.
    const a2 = await Client.open(`scope=room&id=${token}`);
    expect((await a2.hello(memberId)).space.kind).toBe('room');
  });

  it('says not found for a wrong code', async () => {
    const r = await post('/v1/join', { code: '000000' });
    expect(r.status).toBe(404);
  });
});

describe('wifi', () => {
  it('puts devices behind the same IP in one space, and only the adder can delete', async () => {
    const a = await Client.open('scope=wifi', '198.51.100.20');
    const b = await Client.open('scope=wifi', '198.51.100.20');
    const other = await Client.open('scope=wifi', '198.51.100.99');
    await a.hello();
    await b.hello();
    await other.hello();

    const id = cid();
    const ack = await a.request({ t: 'text.add', cid: id, body: '  hello https://example.com  ' });
    expect(ack.data.deleteToken).toBeTruthy();
    const added = await b.next((m) => m.t === 'item.added');
    expect(added.item.body).toBe('hello https://example.com');
    expect(added.item.code).toMatch(/^[2-9A-HJ-NP-Z]{4}$/);
    await expect(other.next((m) => m.t === 'item.added', 300)).rejects.toThrow();

    expect(await b.request({ t: 'item.delete', id })).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await a.request({ t: 'item.delete', id, deleteToken: ack.data.deleteToken })).ok).toBe(true);
  });

  it('renames devices and rate-limits bursts', async () => {
    const a = await Client.open('scope=wifi', '192.0.2.44');
    await a.hello();
    expect((await a.request({ t: 'device.rename', name: 'Kitchen PC' })).data).toEqual({ name: 'Kitchen PC' });
    expect((await a.request({ t: 'device.rename', name: '' })).ok).toBe(false);
    const results = await Promise.all(Array.from({ length: 40 }, () => a.request({ t: 'device.rename', name: 'Spam' })));
    expect(results.some((r) => r.error === 'rate_limited')).toBe(true);
  });
});
