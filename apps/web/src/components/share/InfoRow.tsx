import { Info } from 'lucide-react';
import type { Mode } from '../../lib/space';
import { t } from '../../strings/en';

export function InfoRow({ mode }: { mode: Mode }) {
  const i = t.info[mode];
  return (
    <section className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
      <p className="flex items-center gap-2">
        <Info size={16} className="shrink-0" aria-hidden />
        {i.scope}
      </p>
      <ul className="flex flex-wrap gap-2">
        {i.chips.map((c) => (
          <li key={c} className="chip">
            {c}
          </li>
        ))}
      </ul>
    </section>
  );
}
