import { CONNECT_CARD_DELAY } from '@dropzy/shared';
import { Copy, Link2, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog, Qr } from './Dialogs';
import { WifiConnect } from './WifiConnect';

/**
 * Shown while you're alone (Wi-Fi: after 8 s; Private and Room: right away).
 * Once someone else is here it collapses to a "Connect a device" button (§6.3.3).
 */
export function ConnectCard() {
  const mode = useApp((s) => s.mode);
  const alone = useApp((s) => (Array.isArray(s.peers) ? s.peers.filter((p) => p.peerId !== s.peerId).length === 0 : s.peers.count <= 1));
  const busy = useApp((s) => !Array.isArray(s.peers));
  const [waited, setWaited] = useState(mode !== 'wifi');
  const [dialog, setDialog] = useState(false);

  useEffect(() => {
    if (mode !== 'wifi' || !alone) return;
    const id = window.setTimeout(() => setWaited(true), CONNECT_CARD_DELAY);
    return () => clearTimeout(id);
  }, [mode, alone]);

  if (busy && mode === 'wifi') return null;

  if (alone && waited) {
    return (
      <section className="card p-5 sm:p-6" aria-live="polite">
        <ConnectContent />
      </section>
    );
  }
  if (alone) return null;

  return (
    <div className="flex justify-end">
      <button type="button" className="btn-secondary" onClick={() => setDialog(true)}>
        <Smartphone size={16} aria-hidden />
        {t.connect.button}
      </button>
      {dialog && (
        <Dialog open onClose={() => setDialog(false)} title={t.connect.button} wide>
          <ConnectContent inDialog />
        </Dialog>
      )}
    </div>
  );
}

function ConnectContent({ inDialog = false }: { inDialog?: boolean }) {
  const mode = useApp((s) => s.mode);
  if (mode === 'wifi') return <WifiConnect inDialog={inDialog} />;
  return <LinkConnect />;
}

function LinkConnect() {
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
