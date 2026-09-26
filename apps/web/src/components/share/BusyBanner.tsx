import { Search } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';

// Busy network: others' items are hidden; find one by its code, or start a Private Share (§7.1).
export function BusyBanner() {
  const space = useSpace();
  const busy = useApp((s) => !!s.space?.busy);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  if (!busy) return null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-accent bg-white p-4 text-sm text-slate-950 dark:border-accent dark:bg-night-card dark:text-white">
      <p>
        {t.moments.busy}{' '}
        <a href="/private" className="font-medium underline">
          {t.nav.privateLong}
        </a>
      </p>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg('');
          if (!(await space.find(code))) setMsg(t.find.notFound);
          else setCode('');
        }}
      >
        <label className="sr-only" htmlFor="find-code">
          {t.find.label}
        </label>
        <input
          id="find-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={4}
          placeholder={t.find.placeholder}
          autoCapitalize="characters"
          autoComplete="off"
          className="input max-w-40 font-mono tracking-widest uppercase"
        />
        <button type="submit" className="btn-secondary" disabled={code.trim().length !== 4}>
          <Search size={16} aria-hidden />
          {t.find.button}
        </button>
      </form>
      {msg && <p role="alert">{msg}</p>}
    </section>
  );
}
