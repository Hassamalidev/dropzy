import { Clock, Copy, Link2, Lock, LockOpen, Plus } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { duration } from '../../lib/format';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog, Qr } from './Dialogs';

// Private and Room status (§6.3.4).
export function StatusCard() {
  const space = useSpace();
  const mode = useApp((s) => s.mode);
  const info = useApp((s) => s.space);
  const now = useApp((s) => s.now);
  const [bigQr, setBigQr] = useState(false);
  if (!info || mode === 'wifi') return null;

  const left = (info.expiresAt ?? now) - now;
  const atMax = !!info.expiresAt && !!info.maxExpiresAt && info.expiresAt >= info.maxExpiresAt;
  const url = space.shareUrl();

  const extend = (
    <button type="button" className="btn-secondary" onClick={() => space.extend()} disabled={atMax} title={atMax ? t.status.maxReached : undefined}>
      <Plus size={16} aria-hidden />
      {t.status.extend} {mode === 'ses' ? t.status.extendPrivate : t.status.extendRoom}
    </button>
  );
  const countdown = (
    <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
      <span className="size-2 rounded-full bg-live" aria-hidden />
      <Clock size={14} aria-hidden />
      {t.status.endsIn(duration(left))}
      {atMax && <span className="text-xs text-slate-500">· {t.status.maxReached}</span>}
    </p>
  );

  if (mode === 'ses') {
    return (
      <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <button type="button" className="cursor-zoom-in self-center" onClick={() => setBigQr(true)} aria-label={t.status.enlargeQr}>
          <Qr text={url} size={96} label={t.status.enlargeQr} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="flex items-center gap-2 font-medium text-slate-900 dark:text-white">
            <Lock size={16} className="text-live" aria-hidden />
            {t.status.e2ee}
          </p>
          {countdown}
          <div className="flex flex-col gap-2 sm:flex-row">
            <input readOnly value={url} aria-label={t.status.link} className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="btn-primary shrink-0"
              onClick={async () => space.toast((await copyText(url)) ? t.toast.linkCopied : t.toast.copyFailed)}
            >
              <Copy size={16} aria-hidden />
              {t.connect.copyLink}
            </button>
          </div>
        </div>
        <div className="flex sm:self-start">{extend}</div>
        {bigQr && (
          <Dialog open onClose={() => setBigQr(false)} title={t.connect.privateTitle}>
            <div className="flex justify-center">
              <Qr text={url} size={280} label={t.connect.privateTitle} />
            </div>
          </Dialog>
        )}
      </section>
    );
  }

  const code = info.code ?? '';
  return (
    <section className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">{t.status.roomCode}</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-3xl font-semibold tracking-[0.3em] text-slate-900 sm:text-4xl dark:text-white">
            {code}
          </span>
          <button
            type="button"
            className="btn-icon"
            aria-label={t.status.copyCode}
            onClick={async () => space.toast((await copyText(code)) ? t.toast.codeCopied : t.toast.copyFailed)}
          >
            <Copy size={18} aria-hidden />
          </button>
        </div>
        {countdown}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm dark:border-slate-700">
          <input
            type="checkbox"
            role="switch"
            aria-checked={!!info.locked}
            className="size-4 accent-accent"
            checked={!!info.locked}
            onChange={(e) => space.lock(e.target.checked)}
          />
          {info.locked ? <Lock size={15} aria-hidden /> : <LockOpen size={15} aria-hidden />}
          {t.status.lockRoom}
        </label>
        {extend}
        <button
          type="button"
          className="btn-primary"
          onClick={async () => space.toast((await copyText(url)) ? t.toast.linkCopied : t.toast.copyFailed)}
        >
          <Link2 size={16} aria-hidden />
          {t.connect.copyJoinLink}
        </button>
      </div>
    </section>
  );
}
