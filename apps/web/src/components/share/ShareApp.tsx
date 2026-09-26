import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { keyFromHash } from '../../lib/crypto/keys';
import { nextUtcMidnight } from '../../lib/format';
import { initPasteShortcut } from '../../lib/shortcuts';
import { type Mode, Space } from '../../lib/space';
import { t } from '../../strings/en';
import { ExpiryBanner, OfflinePill } from './Banners';
import { ConnectCard } from './ConnectCard';
import { SpaceCtx, useApp } from './context';
import { DevicesBar } from './DevicesBar';
import { FilesPanel } from './FilesPanel';
import { Hero } from './Hero';
import { InfoRow } from './InfoRow';
import { StatusCard } from './StatusCard';
import { TextPanel } from './TextPanel';
import { Toasts } from './Toasts';

function tokenFromPath(): string | null {
  const m = /^\/[sr]\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}

export default function ShareApp({ mode }: { mode: Mode }) {
  const [space] = useState(() => {
    const token = mode === 'wifi' ? null : tokenFromPath();
    const key = mode === 'ses' ? keyFromHash() : null;
    return new Space(mode, token, key);
  });

  useEffect(() => {
    space.start();
    const off = initPasteShortcut();
    return () => {
      off();
      space.stop();
    };
  }, [space]);

  return (
    <SpaceCtx.Provider value={space}>
      <Screen mode={mode} />
      <Toasts />
    </SpaceCtx.Provider>
  );
}

function Screen({ mode }: { mode: Mode }) {
  const conn = useApp((s) => s.conn);
  const everOpen = useApp((s) => s.everOpen);

  if (conn === 'missing_key') return <EndState text={t.moments.missingKey} mode={mode} />;
  if (conn === 'ended') return <EndState text={t.moments.ended} mode={mode} />;
  if (conn === 'not_found' || conn === 'forbidden') return <EndState text={t.moments.notFound} mode={mode} />;
  if (conn === 'locked') return <EndState text={t.moments.locked} mode={mode} />;
  if (conn === 'capacity') return <Capacity mode={mode} />;

  return (
    <>
      <OfflinePill />
      <Hero mode={mode} />
      {!everOpen ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-slate-500" role="status">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          {t.starting.connecting}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ExpiryBanner />
          <DevicesBar />
          <StatusCard />
          <ConnectCard />
          <div className="grid items-start gap-4 md:grid-cols-2">
            <FilesPanel />
            <TextPanel />
          </div>
          <InfoRow mode={mode} />
        </div>
      )}
    </>
  );
}

function Capacity({ mode }: { mode: Mode }) {
  return <EndState text={t.moments.atCapacity(nextUtcMidnight())} mode={mode} noRestart />;
}

function EndState({ text, mode, noRestart }: { text: string; mode: Mode; noRestart?: boolean }) {
  const href = mode === 'room' ? '/room/new' : mode === 'ses' ? '/private' : '/';
  return (
    <section className="card mx-auto my-10 flex max-w-lg flex-col items-center gap-4 p-8 text-center" role="alert">
      <p className="text-lg text-slate-800 dark:text-slate-100">{text}</p>
      {!noRestart && (
        <a href={href} className="btn-primary">
          {t.moments.startNew}
        </a>
      )}
    </section>
  );
}
