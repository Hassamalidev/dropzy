import { QrCode } from 'lucide-react';
import { useState } from 'react';
import type { Mode } from '../../lib/space';
import { t } from '../../strings/en';
import { LinkConnect } from './ConnectCard';
import { useApp } from './context';
import { Dialog } from './Dialogs';
import { WifiConnect } from './WifiConnect';

export function Hero({ mode }: { mode: Mode }) {
  const h = t.hero[mode];
  const conn = useApp((s) => s.conn);
  const everOpen = useApp((s) => s.everOpen);
  const [connect, setConnect] = useState(false);
  const live = conn === 'open';

  return (
    <section className="flex flex-col items-center gap-2.5 pt-5 pb-5 text-center sm:pt-6">
      <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">{h.title}</h1>
      <p className="text-balance text-slate-600 dark:text-slate-300">{h.subtitle}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <span role="status" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-800 dark:border-night-line dark:bg-night-card dark:text-slate-100">
          <span className={`size-2 rounded-full ${live ? 'bg-live' : 'animate-pulse bg-slate-400'}`} aria-hidden />
          {live ? h.active : everOpen ? t.hero.reconnecting : t.starting.connecting}
        </span>
        <button type="button" className="btn-secondary min-h-10 px-3.5" onClick={() => setConnect(true)} disabled={!everOpen}>
          <QrCode size={16} aria-hidden />
          {t.hero.openOther}
        </button>
      </div>
      {connect && (
        <Dialog open onClose={() => setConnect(false)} title={t.hero.openOther} wide>
          {mode === 'wifi' ? <WifiConnect /> : <LinkConnect />}
        </Dialog>
      )}
    </section>
  );
}
