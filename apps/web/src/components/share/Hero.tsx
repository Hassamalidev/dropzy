import { Check } from 'lucide-react';
import type { Mode } from '../../lib/space';
import { t } from '../../strings/en';

export function Hero({ mode }: { mode: Mode }) {
  const h = t.hero[mode];
  return (
    <section className="pt-4 pb-6 text-center sm:pt-8 sm:pb-8">
      <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">{h.title}</h1>
      <p className="mx-auto mt-3 max-w-xl text-pretty text-slate-600 dark:text-slate-400">{h.subtitle}</p>
      <ul className="mt-5 hidden flex-wrap justify-center gap-2 sm:flex">
        {h.chips.map((c) => (
          <li key={c} className="chip">
            <Check size={14} className="text-live" aria-hidden />
            {c}
          </li>
        ))}
      </ul>
    </section>
  );
}
