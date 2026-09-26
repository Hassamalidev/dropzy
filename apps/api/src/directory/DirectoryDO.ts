import { randomDigits, randomSearchCode } from '@dropzy/shared';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

// Room codes, pair codes and file codes (§7.1, §7.3, §12). Single instance named "directory".
// Rooms and pairs use 6 digits; files use 4 characters from the search alphabet, so the two never collide.

type CodeRow = {
  code: string;
  kind: 'room' | 'pass' | 'file';
  target: string;
  expires_at: number;
  locked: number;
  single_use: number;
};

export type Lookup =
  | { ok: true; kind: 'room'; token: string }
  | { ok: true; kind: 'pass'; pass: string }
  | { ok: true; kind: 'file'; ref: string }
  | { ok: false; error: 'not_found' | 'locked' };

const FAIL_WINDOW = 60_000;
const FAIL_THRESHOLD = 300;

export class DirectoryDO extends DurableObject<Env> {
  private sql: SqlStorage;
  // Global throttle counters live in memory; fine if they reset (§12).
  private failures: number[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS codes (
      code TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL,
      expires_at INTEGER NOT NULL, locked INTEGER NOT NULL DEFAULT 0, single_use INTEGER NOT NULL DEFAULT 0
    )`);
  }

  private live(code: string, now = Date.now()): CodeRow | null {
    const row = this.sql.exec<CodeRow>('SELECT * FROM codes WHERE code = ?', code).toArray()[0];
    if (!row) return null;
    if (row.expires_at <= now) {
      this.sql.exec('DELETE FROM codes WHERE code = ?', code); // purge lazily
      return null;
    }
    return row;
  }

  private allocate(kind: CodeRow['kind'], target: string, expiresAt: number, singleUse: boolean): string {
    for (let i = 0; i < 50; i++) {
      const code = kind === 'file' ? randomSearchCode() : randomDigits(6);
      if (this.live(code)) continue;
      this.sql.exec(
        'INSERT OR REPLACE INTO codes (code, kind, target, expires_at, locked, single_use) VALUES (?, ?, ?, ?, 0, ?)',
        code,
        kind,
        target,
        expiresAt,
        singleUse ? 1 : 0,
      );
      return code;
    }
    throw new Error('code space exhausted');
  }

  async allocateRoom(token: string, expiresAt: number): Promise<string> {
    return this.allocate('room', token, expiresAt, false);
  }

  async allocatePair(pass: string, expiresAt: number): Promise<string> {
    return this.allocate('pass', pass, expiresAt, true);
  }

  /** A file's code, typed on the Join page to download it (target = single-file ref). */
  async allocateFile(ref: string, expiresAt: number): Promise<string> {
    return this.allocate('file', ref, expiresAt, false);
  }

  /** Frees a file's code, but only while it still points at that file. */
  async releaseFile(code: string, ref: string): Promise<void> {
    this.sql.exec("DELETE FROM codes WHERE code = ? AND kind = 'file' AND target = ?", code, ref);
  }

  async updateRoom(code: string, patch: { expiresAt?: number; locked?: boolean }): Promise<void> {
    if (patch.expiresAt !== undefined) this.sql.exec('UPDATE codes SET expires_at = ? WHERE code = ?', patch.expiresAt, code);
    if (patch.locked !== undefined) this.sql.exec('UPDATE codes SET locked = ? WHERE code = ?', patch.locked ? 1 : 0, code);
  }

  async release(code: string): Promise<void> {
    this.sql.exec('DELETE FROM codes WHERE code = ?', code);
  }

  async lookup(code: string): Promise<Lookup> {
    const row = this.live(code);
    if (!row) {
      await this.slowFailures();
      return { ok: false, error: 'not_found' };
    }
    if (row.kind === 'room') {
      if (row.locked) return { ok: false, error: 'locked' };
      return { ok: true, kind: 'room', token: row.target };
    }
    if (row.kind === 'file') return { ok: true, kind: 'file', ref: row.target };
    if (row.single_use) this.sql.exec('DELETE FROM codes WHERE code = ?', code);
    return { ok: true, kind: 'pass', pass: row.target };
  }

  /** More than 300 failed lookups in the last minute → delay failures by 1–2 s (§7.3). */
  private async slowFailures() {
    const now = Date.now();
    this.failures.push(now);
    while (this.failures.length && this.failures[0] < now - FAIL_WINDOW) this.failures.shift();
    if (this.failures.length > FAIL_THRESHOLD) {
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
    }
  }
}
