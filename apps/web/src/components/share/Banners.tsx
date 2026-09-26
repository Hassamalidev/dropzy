import { EXPIRY_WARNING } from '@dropzy/shared';
import { AlertTriangle, Clock, WifiOff } from 'lucide-react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';

/** "Offline — reconnecting…" pill whenever the socket is down (§6.3). */
export function OfflinePill() {
  const conn = useApp((s) => s.conn);
  const everOpen = useApp((s) => s.everOpen);
  if (conn !== 'offline' && !(conn === 'connecting' && everOpen)) return null;
  return (
    <div role="status" className="fixed top-3 left-1/2 z-50 -translate-x-1/2">
      <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-slate-950 dark:bg-accent dark:text-white">
        <WifiOff size={15} aria-hidden />
        {t.moments.offline}
      </span>
    </div>
  );
}

/** At 10 minutes left: "This share ends in 10 minutes. Keep it longer" (§6.3.4). */
export function ExpiryBanner() {
  const space = useSpace();
  const info = useApp((s) => s.space);
  const now = useApp((s) => s.now);
  if (!info?.expiresAt) return null;
  const left = info.expiresAt - now;
  const atMax = !!info.maxExpiresAt && info.expiresAt >= info.maxExpiresAt;
  if (left > EXPIRY_WARNING || left <= 0 || atMax) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent bg-white px-4 py-3 text-sm text-slate-950 dark:border-accent dark:bg-night-card dark:text-white">
      <span className="flex items-center gap-2">
        <Clock size={16} aria-hidden />
        {t.status.endingSoon}
      </span>
      <button type="button" className="btn-secondary min-h-9" onClick={() => space.extend()}>
        {t.status.keepLonger}
      </button>
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div
      role="status"
      className={
        tone === 'warn'
          ? 'flex items-start gap-2 rounded-2xl border border-accent bg-white px-4 py-3 text-sm text-slate-950 dark:border-accent dark:bg-night-card dark:text-white'
          : 'flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 dark:border-night-line dark:bg-night-card dark:text-slate-100'
      }
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
