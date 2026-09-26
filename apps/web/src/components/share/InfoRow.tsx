import { Clock, Info, Lock, UserX, Zap } from 'lucide-react';
import type { Mode } from '../../lib/space';
import { t } from '../../strings/en';

const ICONS = { clock: Clock, lock: Lock, user: UserX, zap: Zap } as const;

export function InfoRow({ mode }: { mode: Mode }) {
  const i = t.info[mode];
  return (
    <section className="flex flex-col gap-3 px-1 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between dark:text-slate-400">
      <p className="flex items-center gap-2">
        <Info size={16} className="shrink-0" aria-hidden />
        {i.scope}
      </p>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {i.chips.map(([icon, label]) => {
          const Icon = ICONS[icon];
          return (
            <li key={label} className="inline-flex items-center gap-1.5">
              <Icon size={15} aria-hidden />
              {label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
