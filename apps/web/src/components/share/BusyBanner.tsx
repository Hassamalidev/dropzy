import { AlertTriangle } from 'lucide-react';
import { t } from '../../strings/en';
import { useApp } from './context';

// Busy network: others' items are hidden; find one by its code in the search bar, or start a Private Share (§7.1).
export function BusyBanner() {
  const busy = useApp((s) => !!s.space?.busy);
  if (!busy) return null;
  return (
    <section className="flex items-start gap-2 rounded-2xl border border-accent bg-white px-4 py-3 text-sm text-slate-950 dark:border-accent dark:bg-night-card dark:text-white">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        {t.moments.busy}{' '}
        <a href="/private" className="font-medium underline">
          {t.nav.privateLong}
        </a>
      </p>
    </section>
  );
}
