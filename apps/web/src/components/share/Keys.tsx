import { Fragment } from 'react';

/** A keyboard shortcut hint such as Ctrl + V, shown on devices with a keyboard. */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="hidden items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 sm:inline-flex dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
      {keys.map((k, i) => (
        <Fragment key={k}>
          {i > 0 && <span className="text-slate-400">+</span>}
          <kbd className="border-0 bg-transparent p-0">{k}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
