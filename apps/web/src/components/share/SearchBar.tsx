import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';

/** True when any field contains the query (case-insensitive). An empty query matches everything. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
}

/**
 * One search for files and text: code, file name, text or sender. "/" focuses it, Esc clears it.
 * On a busy network, Enter on a 4-character code asks the network for that item (§7.1).
 */
export function SearchBar({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const space = useSpace();
  const busy = useApp((s) => !!s.space?.busy);
  const ref = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || el?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return (
    <form
      role="search"
      className="relative w-full sm:w-80"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = query.trim();
        if (!busy || !/^[A-Za-z0-9]{4}$/.test(code)) return;
        setMsg((await space.find(code)) ? '' : t.find.notFound);
      }}
    >
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={query}
        onChange={(e) => {
          setMsg('');
          onQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.preventDefault();
            onQuery('');
          }
        }}
        placeholder={t.search.placeholder}
        aria-label={t.search.label}
        title={t.search.shortcut}
        autoComplete="off"
        className="input py-2 pr-16 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => {
            onQuery('');
            ref.current?.focus();
          }}
          aria-label={t.search.clear}
        >
          <X size={15} aria-hidden />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 sm:block">/</kbd>
      )}
      {msg && (
        <p role="alert" className="absolute top-full right-0 mt-1 text-xs text-accent-ink">
          {msg}
        </p>
      )}
    </form>
  );
}
