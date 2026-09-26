import { Loader2 } from 'lucide-react';
import { siteHost, t } from '../../strings/en';

// Wi-Fi "Waiting for your other device…" content (§6.3.3).
export function WifiConnect({ inDialog = false }: { inDialog?: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-center sm:text-left">
      {!inDialog && (
        <h2 className="flex items-center justify-center gap-2 text-lg font-semibold text-slate-900 sm:justify-start dark:text-white">
          <Loader2 size={18} className="animate-spin text-accent" aria-hidden />
          {t.connect.waitingTitle}
        </h2>
      )}
      <p className="text-sm text-slate-600 dark:text-slate-400">{t.connect.wifiLine1}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {siteHost} · {t.connect.wifiLine2NoCode}
      </p>
      <a href="/private" className="link text-sm">
        {t.connect.differentNetworks}
      </a>
    </div>
  );
}
