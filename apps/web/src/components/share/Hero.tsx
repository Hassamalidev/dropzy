import type { Mode } from '../../lib/space';
import { t } from '../../strings/en';

export function Hero({ mode }: { mode: Mode }) {
  return (
    <section className="pt-2 pb-4 text-center sm:pt-4 sm:pb-5">
      <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
        {t.hero[mode].title}
      </h1>
    </section>
  );
}
