import type { PassCreateAck } from '@dropzy/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '../../strings/en';
import { useSpace } from './context';
import { Qr } from './Dialogs';

// Wi-Fi "Waiting for your other device…" with a network-pass QR and a 6-digit pair code (§6.3.3, §7.1).
export function WifiConnect({ inDialog = false }: { inDialog?: boolean }) {
  const space = useSpace();
  const [pass, setPass] = useState<PassCreateAck | null>(null);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = async () => {
      const p = await space.createPass();
      if (!live) return;
      setPass(p);
      // The pair code lasts 10 minutes; make a fresh one when it runs out.
      if (p) timer = window.setTimeout(load, Math.max(30_000, p.expiresAt - Date.now()));
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [space]);

  const url = pass ? `${location.origin}/#p=${pass.pass}` : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      {url ? (
        <Qr text={url} size={172} label={t.connect.button} />
      ) : (
        <div className="flex size-[172px] shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
          <Loader2 className="animate-spin text-slate-400" aria-label={t.connect.loading} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3 text-center sm:text-left">
        {!inDialog && (
          <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-slate-900 sm:justify-start dark:text-white">
            <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
            {t.connect.waitingTitle}
          </h2>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-400">{t.connect.wifiLine1}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {pass ? t.connect.wifiLine2(pass.code) : t.connect.wifiLine2NoCode}
        </p>
        {pass && (
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">{t.connect.pairCode}</p>
            <p className="font-mono text-3xl font-semibold tracking-[0.3em] text-slate-900 dark:text-white">{pass.code}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t.connect.passExpires}</p>
          </div>
        )}
        <a href="/private" className="link text-sm">
          {t.connect.differentNetworks}
        </a>
      </div>
    </div>
  );
}
