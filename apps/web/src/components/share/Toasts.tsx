import { X } from 'lucide-react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';

// Bottom-center on mobile, bottom-right on desktop, max 3, polite live region (§6.3).
export function Toasts() {
  const space = useSpace();
  const toasts = useApp((s) => s.toasts);
  const live = useApp((s) => s.live);
  return (
    <>
      <div className="sr-only" aria-live="polite">
        {live}
      </div>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:items-end"
      >
        {toasts.map((x) => (
          <div
            key={x.id}
            className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-xl bg-slate-900 py-2 pr-2 pl-4 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
          >
            <span className="py-1">{x.text}</span>
            {x.action && (
              <button
                type="button"
                className="min-h-9 cursor-pointer rounded-lg px-3 font-semibold text-orange-300 underline underline-offset-2 hover:bg-white/10 dark:text-orange-700 dark:hover:bg-slate-900/10"
                onClick={() => {
                  x.action?.run();
                  space.dismiss(x.id);
                }}
              >
                {x.action.label}
              </button>
            )}
            <button
              type="button"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg opacity-70 hover:opacity-100"
              onClick={() => space.dismiss(x.id)}
              aria-label={t.toast.dismiss}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
