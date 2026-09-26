import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { HttpError, api } from '../../lib/api';
import { t } from '../../strings/en';

/**
 * "Got a file code?" — type a file's 4-character code to download it here. Private Share files
 * get their key from a device still open in that share (the /f page asks for it).
 */
export function FileCodeBox() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

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
          setMsg(k === 'rate_limited' ? t.moments.rateLimited : k === 'not_found' ? t.join.fileNotFound : t.starting.failed);
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
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4));
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
