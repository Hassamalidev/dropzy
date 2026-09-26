import { Copy, Link2 } from 'lucide-react';
import { copyText } from '../../lib/clipboard';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Qr } from './Dialogs';

/**
 * Room: the invite card while you're alone. Once someone else is here it goes away — the hero's
 * "Open on another device" button shows the same thing. Private Share's session card already has
 * the QR and link, and Wi-Fi Share needs no card.
 */
export function ConnectCard() {
  const mode = useApp((s) => s.mode);
  const alone = useApp((s) => (Array.isArray(s.peers) ? s.peers.filter((p) => p.peerId !== s.peerId).length === 0 : s.peers.count <= 1));
  if (mode !== 'room' || !alone) return null;
  return (
    <section className="card p-5 sm:p-6" aria-live="polite">
      <LinkConnect />
    </section>
  );
}

export function LinkConnect() {
  const space = useSpace();
  const mode = useApp((s) => s.mode);
  const code = useApp((s) => s.space?.code);
  const url = space.shareUrl();
  const room = mode === 'room';
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <Qr text={url} size={172} label={room ? t.connect.roomTitle : t.connect.privateTitle} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 text-center sm:text-left">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          {room ? t.connect.roomTitle : t.connect.privateTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{room ? t.connect.roomHint : t.connect.privateHint}</p>
        {room && code && (
          <p className="font-mono text-3xl font-semibold tracking-[0.3em] text-slate-900 dark:text-white">
            <span className="sr-only">{t.status.roomCode} </span>
            {code}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={url} className="input font-mono text-xs" aria-label={t.status.link} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="btn-primary shrink-0"
            onClick={async () => space.toast((await copyText(url)) ? t.toast.linkCopied : t.toast.copyFailed)}
          >
            {room ? <Link2 size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {room ? t.connect.copyJoinLink : t.connect.copyLink}
          </button>
        </div>
      </div>
    </div>
  );
}
