import { randomId } from '@dropzy/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

// Reports and feedback (§12, §14.7). Single instance named "admin".

export type Report = {
  id: string;
  ref: string;
  item_id: string;
  reason: string;
  note: string | null;
  reporter_ip_hash: string;
  created_at: number;
  status: 'open' | 'deleted' | 'blocked' | 'dismissed';
};

export type Feedback = { id: string; type: 'feature' | 'contact'; message: string; email: string | null; created_at: number };

const KEEP = 30 * 86_400_000;
const MAX_OPEN = 5_000;

export class AdminDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, ref TEXT NOT NULL, item_id TEXT NOT NULL, reason TEXT NOT NULL, note TEXT,
      reporter_ip_hash TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, message TEXT NOT NULL, email TEXT, created_at INTEGER NOT NULL
    );`);
  }

  private prune() {
    const cutoff = Date.now() - KEEP;
    this.sql.exec('DELETE FROM reports WHERE created_at < ?', cutoff);
    this.sql.exec('DELETE FROM feedback WHERE created_at < ?', cutoff);
  }

  async addReport(r: { ref: string; itemId: string; reason: string; note?: string; ipHash: string }): Promise<string | null> {
    if (Math.random() < 0.05) this.prune();
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").one().n;
    if (n >= MAX_OPEN) return null;
    // One open report per item per reporter is enough.
    const dup = this.sql
      .exec<{ id: string }>("SELECT id FROM reports WHERE item_id = ? AND reporter_ip_hash = ? AND status = 'open'", r.itemId, r.ipHash)
      .toArray()[0];
    if (dup) return dup.id;
    const id = randomId();
    this.sql.exec(
      'INSERT INTO reports (id, ref, item_id, reason, note, reporter_ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      r.ref,
      r.itemId,
      r.reason,
      r.note ?? null,
      r.ipHash,
      Date.now(),
    );
    return id;
  }

  async addFeedback(f: { type: 'feature' | 'contact'; message: string; email?: string }): Promise<string> {
    if (Math.random() < 0.05) this.prune();
    const id = randomId();
    this.sql.exec(
      'INSERT INTO feedback (id, type, message, email, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      f.type,
      f.message,
      f.email ?? null,
      Date.now(),
    );
    return id;
  }

  async overview() {
    return {
      reports: this.sql.exec<Report>("SELECT * FROM reports WHERE status = 'open' ORDER BY created_at DESC LIMIT 200").toArray(),
      feedback: this.sql.exec<Feedback>('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 200').toArray(),
    };
  }

  async getReport(id: string): Promise<Report | null> {
    return this.sql.exec<Report>('SELECT * FROM reports WHERE id = ?', id).toArray()[0] ?? null;
  }

  async setStatus(id: string, status: Report['status']) {
    this.sql.exec('UPDATE reports SET status = ? WHERE id = ?', status, id);
  }

  async deleteFeedback(id: string) {
    this.sql.exec('DELETE FROM feedback WHERE id = ?', id);
  }
}
