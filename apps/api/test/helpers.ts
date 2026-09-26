import { SELF } from 'cloudflare:test';

export const ORIGIN = 'http://localhost:4321';

export async function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await SELF.fetch(`https://api.test${path}`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

export class Client {
  ws: WebSocket;
  inbox: any[] = [];
  waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  closed: { code: number; reason: string } | null = null;
  private n = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string);
      const w = this.waiters.findIndex((x) => x.pred(m));
      if (w >= 0) this.waiters.splice(w, 1)[0].resolve(m);
      else this.inbox.push(m);
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
    });
  }

  static async open(query: string, ip = '203.0.113.7'): Promise<Client> {
    const res = await SELF.fetch(`https://api.test/v1/ws?${query}&v=1`, {
      headers: { Upgrade: 'websocket', Origin: ORIGIN, 'CF-Connecting-IP': ip },
    });
    const ws = res.webSocket;
    if (!ws) throw new Error(`no websocket (${res.status})`);
    ws.accept();
    return new Client(ws);
  }

  next(pred: (m: any) => boolean = () => true, ms = 2000): Promise<any> {
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  async request(msg: Record<string, unknown>): Promise<any> {
    const rid = `r${++this.n}`;
    this.ws.send(JSON.stringify({ ...msg, rid }));
    return this.next((m) => m.t === 'ack' && m.rid === rid);
  }

  async hello(deviceId = crypto.randomUUID(), name = 'Blue Fox') {
    const ack = this.request({ t: 'hello', deviceId, name, type: 'windows', caps: { direct: true, maxDirectBytes: 1e9 } });
    const state = await this.next((m) => m.t === 'state');
    await ack;
    return state;
  }

  async waitClosed(ms = 2000) {
    const start = Date.now();
    while (!this.closed && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 20));
    return this.closed;
  }
}

export function cid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
