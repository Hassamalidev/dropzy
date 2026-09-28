// End-to-end check of cloud file storage: upload → download → burn after 1 download → delete.
// Usage: node scripts/e2e-storage.mjs [apiBase] [siteOrigin]
//   node scripts/e2e-storage.mjs http://localhost:8787 http://localhost:4321
import { randomBytes } from 'node:crypto';

const API = process.argv[2] || 'http://localhost:8787';
const ORIGIN = process.argv[3] || 'http://localhost:4321';
const id22 = () => randomBytes(16).toString('base64url').slice(0, 22);

function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) process.exitCode = 1;
  return ok;
}

async function connect(token, deviceId) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/v1/ws?v=1&scope=room&id=${token}`, { headers: { Origin: ORIGIN } });
  const pending = new Map();
  let n = 0;
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'ack' && pending.has(m.rid)) {
      pending.get(m.rid)(m);
      pending.delete(m.rid);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('socket error')), { once: true });
  });
  const req = (msg) =>
    new Promise((res) => {
      const rid = String(++n);
      pending.set(rid, res);
      ws.send(JSON.stringify({ ...msg, rid }));
    });
  const hello = await req({ t: 'hello', deviceId, name: 'e2e', type: 'windows', caps: { direct: false, maxDirectBytes: 0 } });
  if (!hello.ok) throw new Error(`hello failed: ${hello.error}`);
  return { ws, req };
}

async function upload(dev, body, burn) {
  const init = await dev.req({ t: 'upload.init', cid: id22(), size: body.length, name: 'e2e.txt', mime: 'text/plain', e2ee: false, burn });
  if (!check(init.ok, `upload.init (burn=${burn})`)) throw new Error(init.error);
  const { id, url, headers, mode } = init.data;
  check(mode === 'single', 'single-PUT upload target');
  const put = await fetch(url, { method: 'PUT', headers: { ...headers, Origin: ORIGIN }, body });
  check(put.ok, `PUT bytes → ${new URL(url).host} (${put.status})`);
  const done = await dev.req({ t: 'upload.complete', id });
  check(done.ok, `upload.complete (size check via store.head) ${done.ok ? '' : done.error}`);
  return id;
}

async function download(dev, id) {
  const r = await dev.req({ t: 'download.url', id });
  if (!r.ok) return { ok: false, error: r.error };
  const res = await fetch(r.data.url, { headers: { Origin: ORIGIN } });
  return { ok: res.ok, status: res.status, text: await res.text(), url: r.data.url };
}

const room = await (await fetch(`${API}/v1/rooms`, { method: 'POST', headers: { Origin: ORIGIN } })).json();
if (!check(room.ok, 'create room')) process.exit(1);
const health = await (await fetch(`${API}/v1/health`)).json();
check(health.data.storage === true, `/v1/health storage=${health.data.storage}`);

const a = await connect(room.data.token, `sender-${id22()}`);
const b = await connect(room.data.token, `receiver-${id22()}`);
const payload = `hello from dropzy e2e ${new Date().toISOString()}`;

// 1. Normal upload + download.
const keepId = await upload(a, payload, false);
const d1 = await download(b, keepId);
check(d1.ok && d1.text === payload, `download matches upload (${d1.status})`);

// 2. Delete after 1 download: first download works, second is refused.
const burnId = await upload(a, payload, true);
const b1 = await download(b, burnId);
check(b1.ok && b1.text === payload, 'burn item: first download');
const b2 = await download(b, burnId);
check(!b2.ok && b2.error === 'not_found', `burn item: second download refused (${b2.error ?? b2.status})`);

// 3. Delete → object removed from the bucket (store.delete).
const del = await a.req({ t: 'item.delete', id: keepId });
check(del.ok, 'item.delete');
await new Promise((r) => setTimeout(r, 500));
const gone = await fetch(d1.url);
check(gone.status === 404, `object gone from bucket after delete (${gone.status})`);

a.ws.close();
b.ws.close();
console.log(process.exitCode ? '\nSome checks failed.' : '\nAll storage checks passed.');
