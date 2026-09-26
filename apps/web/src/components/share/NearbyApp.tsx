import { Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { nextUtcMidnight } from '../../lib/format';
import { Space } from '../../lib/space';
import { t } from '../../strings/en';
import { OfflinePill } from './Banners';
import { SpaceCtx, useApp, useSpace } from './context';
import { FileItem } from './FileItem';
import type { FileRow } from './FilesPanel';
import { NearbyDevices } from './NearbyDevices';
import { Toasts } from './Toasts';

// The Nearby page: devices on the same network with this page open, by name. Files go to the one
// picked, browser to browser (§9.2). Its own space, apart from Wi-Fi Share's.
export default function NearbyApp() {
  const [space] = useState(() => new Space('wifi', null, null, () => 'scope=nearby'));

  useEffect(() => {
    space.start();
    // Files dropped beside a device (or on one that can't receive) would otherwise make the
    // browser open them in place of this page, dropping the connection.
    const guard = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    addEventListener('dragover', guard);
    addEventListener('drop', guard);
    return () => {
      removeEventListener('dragover', guard);
      removeEventListener('drop', guard);
      space.stop();
    };
  }, [space]);

  return (
    <SpaceCtx.Provider value={space}>
      <Screen />
      <Toasts />
    </SpaceCtx.Provider>
  );
}

function Screen() {
  const conn = useApp((s) => s.conn);
  const everOpen = useApp((s) => s.everOpen);

  return (
    <>
      <OfflinePill />
      <section className="flex flex-col items-center gap-2.5 pt-5 pb-5 text-center sm:pt-6">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{t.devices.hero.title}</h1>
        <p className="text-balance text-slate-600 dark:text-slate-300">{t.devices.hero.subtitle}</p>
      </section>
      {conn !== 'connecting' && conn !== 'open' && conn !== 'offline' ? (
        // Any end state (full, refused, closed…): the socket won't come back by itself.
        <section className="card mx-auto my-6 flex max-w-lg flex-col items-center gap-4 p-8 text-center" role="alert">
          <p className="text-lg text-slate-800 dark:text-slate-100">{conn === 'capacity' ? t.moments.atCapacity(nextUtcMidnight()) : t.moments.generic}</p>
          <a href="/private" className="btn-primary">
            {t.devices.otherNetwork}
          </a>
        </section>
      ) : !everOpen ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-slate-500" role="status">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          {t.devices.searching}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <NearbyDevices />
          <Transfers />
          <a href="/private" className="link inline-flex items-center gap-1.5 self-center text-sm">
            <Lock size={14} aria-hidden />
            {t.devices.otherNetwork}
          </a>
        </div>
      )}
    </>
  );
}

/** Files sent and received here, with progress, Save and Delete. Nothing here is on the server. */
function Transfers() {
  const space = useSpace();
  const transfers = useApp((s) => s.transfers);
  const hidden = useApp((s) => s.hidden);
  const rows: FileRow[] = Object.values(transfers)
    .filter((tr) => (tr.kind === 'send' || tr.kind === 'recv') && !hidden.includes(tr.id))
    .map((tr) => ({ id: tr.id, transfer: tr, createdAt: space.localCreatedAt(tr.id) }))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (!rows.length) return null;

  return (
    <section aria-labelledby="transfers-title" className="card flex flex-col gap-3 p-5">
      <h2 id="transfers-title" className="font-semibold text-slate-900 dark:text-white">
        {t.devices.transfers}
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <FileItem key={r.id} row={r} />
        ))}
      </ul>
    </section>
  );
}
