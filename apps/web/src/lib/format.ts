import { formatBytes } from '@dropzy/shared';
import { t } from '../strings/en';

export { formatBytes };

/** "1 h 42 min" (rounded up to the minute). */
export function duration(ms: number): string {
  if (ms <= 0) return t.time.left(0, 0);
  if (ms < 60_000) return t.time.lessThanMin;
  const mins = Math.ceil(ms / 60_000);
  return t.time.left(Math.floor(mins / 60), mins % 60);
}

export function ago(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  if (d < 60_000) return t.time.justNow;
  if (d < 3_600_000) return t.time.minAgo(Math.floor(d / 60_000));
  return t.time.hAgo(Math.floor(d / 3_600_000));
}

export function speed(bytesPerSec: number): string {
  return t.time.speed((bytesPerSec / 1e6).toFixed(bytesPerSec < 1e7 ? 1 : 0));
}

/** Split a file name so the middle can ellipsize while the extension stays visible. */
export function splitName(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0 || name.length - i > 12) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/** Local time of the next 00:00 UTC, e.g. "5:00 AM" (§4.5). */
export function nextUtcMidnight(): string {
  const n = new Date();
  const d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
