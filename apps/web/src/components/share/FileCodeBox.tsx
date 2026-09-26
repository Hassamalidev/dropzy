import { SEARCH_ALPHABET } from '@dropzy/shared';
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HttpError, api } from '../../lib/api';
import { nextUtcMidnight } from '../../lib/format';
import { t } from '../../strings/en';

/**
 * "Got a file code?" — type a file's 4-character code to download it here. Private Share files
 * get their key from a device still open in that share (the /f page asks for it).
 */
export function FileCodeBox() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Coming back with the Back button restores this page as it was left: mid-navigation.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    addEventListener('pageshow', onShow);
    return () => removeEventListener('pageshow', onShow);
  }, []);

  return (
    <form
      className="relative flex w-full gap-2 sm:w-auto"
      onSubmit={async (e) => {
        e.preventDefault();
        if (code.length !== 4 || busy) return;
        setBusy(true);
        setMsg('');
        try {
          const r = await api.join(code);
          if (r.kind !== 'file') throw new HttpError('not_found');
          location.assign(`/f/${r.ref}?dl=1`);
        } catch (err) {
          const k = err instanceof HttpError ? err.code : '';
          setMsg(
            k === 'rate_limited'
              ? t.moments.rateLimited
              : k === 'not_found'
                ? t.join.fileNotFound
                : k === 'at_capacity'
                  ? t.moments.atCapacity(nextUtcMidnight())
                  : t.starting.failed,
          );
          setBusy(false);
        }
      }}
    >
      <label className="relative flex-1 sm:w-56 sm:flex-none">
        <span className="sr-only">{t.join.fileLabel}</span>
        <KeyRound size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          value={code}
          onChange={(e) => {
            setMsg('');
            // Codes never use 0, 1, I or O, so only keep characters a code can have.
            const v = e.target.value.toUpperCase();
            setCode([...v].filter((c) => SEARCH_ALPHABET.includes(c)).join('').slice(0, 4));
          }}
          placeholder={t.join.fileTitle}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="input py-2 pl-9 font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal"
        />
      </label>
      <button type="submit" className="btn-secondary min-h-10 shrink-0" disabled={code.length !== 4 || busy}>
        {t.join.fileButton}
      </button>
      {msg && (
        <p role="alert" className="absolute top-full left-0 mt-1 text-xs text-accent-ink">
          {msg}
        </p>
      )}
    </form>
  );
}
