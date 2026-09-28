import { DurableObject } from 'cloudflare:workers';
import { type Env, num, storageEnabled } from '../env';
import { makeStore } from '../r2';

// Quotas, cost guard and blocklist (§14.4). Single instance named "guard".
// Stored bytes are tracked reserve → commit → release; R2 operations are estimated per UTC day.

export type Reserve = { ok: true } | { ok: false; error: 'uploads_paused' | 'rate_limited' | 'forbidden' };

type Usage = { day: string; class_a: number; class_b: number; upload_bytes: number };

const DAY = 86_400_000;

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

export class GuardDO extends DurableObject<Env> {
  private sql: SqlStorage;
  // Per-IP daily upload bytes live in memory; lenient if they reset (§12).
  private perIp = new Map<string, number>();
  private perIpDay = utcDay();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS storage (id INTEGER PRIMARY KEY CHECK (id = 1), stored_bytes INTEGER NOT NULL, reserved_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, class_a INTEGER NOT NULL, class_b INTEGER NOT NULL, upload_bytes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (ip_hash TEXT PRIMARY KEY, until INTEGER NOT NULL);
      INSERT OR IGNORE INTO storage (id, stored_bytes, reserved_bytes) VALUES (1, 0, 0);`);
    ctx.blockConcurrencyWhile(async () => {
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(nextDailyRun());
    });
  }

  private limits() {
    return {
      maxStored: num(this.env.MAX_STORED_BYTES, 8 * 1024 ** 3),
      perIp: num(this.env.PER_IP_DAILY_UPLOAD_BYTES, 3 * 1024 ** 3),
      classA: num(this.env.CLASS_A_DAILY_BUDGET, 30_000),
      classB: num(this.env.CLASS_B_DAILY_BUDGET, 300_000),
    };
  }

  private storage() {
    return this.sql.exec<{ stored_bytes: number; reserved_bytes: number }>('SELECT * FROM storage WHERE id = 1').one();
  }

  private usage(day = utcDay()): Usage {
    return (
      this.sql.exec<Usage>('SELECT * FROM usage WHERE day = ?', day).toArray()[0] ?? {
        day,
        class_a: 0,
        class_b: 0,
        upload_bytes: 0,
      }
    );
  }

  private saveUsage(u: Usage) {
    this.sql.exec(
      'INSERT OR REPLACE INTO usage (day, class_a, class_b, upload_bytes) VALUES (?, ?, ?, ?)',
      u.day,
      u.class_a,
      u.class_b,
      u.upload_bytes,
    );
  }

  private blocked(ipHash: string): boolean {
    const row = this.sql.exec<{ until: number }>('SELECT until FROM blocks WHERE ip_hash = ?', ipHash).toArray()[0];
    return !!row && row.until > Date.now();
  }

  /** 'paused' once any budget is reached, until the next UTC day (or until space frees up). */
  async status(): Promise<'on' | 'paused'> {
    const l = this.limits();
    const s = this.storage();
    const u = this.usage();
    if (s.stored_bytes + s.reserved_bytes >= l.maxStored) return 'paused';
    if (u.class_a >= l.classA || u.class_b >= l.classB) return 'paused';
    return 'on';
  }

  async reserve(ipHash: string, bytes: number, classA: number): Promise<Reserve> {
    if (this.blocked(ipHash)) return { ok: false, error: 'forbidden' };
    const l = this.limits();
    const day = utcDay();
    if (day !== this.perIpDay) {
      this.perIp.clear();
      this.perIpDay = day;
    }
    const mine = this.perIp.get(ipHash) ?? 0;
    if (mine + bytes > l.perIp) return { ok: false, error: 'rate_limited' };
    const s = this.storage();
    if (s.stored_bytes + s.reserved_bytes + bytes > l.maxStored) return { ok: false, error: 'uploads_paused' };
    const u = this.usage(day);
    if (u.class_a + classA > l.classA || u.class_b >= l.classB) return { ok: false, error: 'uploads_paused' };

    this.sql.exec('UPDATE storage SET reserved_bytes = reserved_bytes + ? WHERE id = 1', bytes);
    u.class_a += classA;
    u.upload_bytes += bytes;
    this.saveUsage(u);
    this.perIp.set(ipHash, mine + bytes);
    return { ok: true };
  }

  async commit(bytes: number): Promise<void> {
    this.sql.exec(
      'UPDATE storage SET reserved_bytes = MAX(0, reserved_bytes - ?), stored_bytes = stored_bytes + ? WHERE id = 1',
      bytes,
      bytes,
    );
  }

  async release(bytes: number, committed: boolean): Promise<void> {
    if (committed) this.sql.exec('UPDATE storage SET stored_bytes = MAX(0, stored_bytes - ?) WHERE id = 1', bytes);
    else this.sql.exec('UPDATE storage SET reserved_bytes = MAX(0, reserved_bytes - ?) WHERE id = 1', bytes);
  }

  /** Count one Class B operation (a download URL). False when the daily budget is spent. */
  async classB(n = 1): Promise<boolean> {
    const u = this.usage();
    if (u.class_b + n > this.limits().classB) return false;
    u.class_b += n;
    this.saveUsage(u);
    return true;
  }

  async block(ipHash: string, until: number): Promise<void> {
    this.sql.exec('INSERT OR REPLACE INTO blocks (ip_hash, until) VALUES (?, ?)', ipHash, until);
  }

  async isBlocked(ipHash: string): Promise<boolean> {
    return this.blocked(ipHash);
  }

  async report() {
    const l = this.limits();
    const s = this.storage();
    return {
      day: utcDay(),
      usage: this.usage(),
      storedBytes: s.stored_bytes,
      reservedBytes: s.reserved_bytes,
      limits: l,
      status: await this.status(),
      blocks: this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM blocks WHERE until > ?', Date.now()).one().n,
    };
  }

  /** Daily: recompute stored bytes from a bucket list and purge old rows (§12). */
  async alarm(): Promise<void> {
    try {
      const total = storageEnabled(this.env) ? await makeStore(this.env, '').totalSize('f/') : 0;
      this.sql.exec('UPDATE storage SET stored_bytes = ? WHERE id = 1', total);
    } catch (err) {
      console.error('guard reconcile', (err as Error).message);
    }
    this.sql.exec('DELETE FROM usage WHERE day < ?', utcDay(Date.now() - 7 * DAY));
    this.sql.exec('DELETE FROM blocks WHERE until < ?', Date.now());
    await this.ctx.storage.setAlarm(nextDailyRun());
  }
}

function nextDailyRun(): number {
  const n = new Date();
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 5);
}
