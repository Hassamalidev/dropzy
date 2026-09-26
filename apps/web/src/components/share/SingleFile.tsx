import { DEVICE_LABEL, type FileMeta, isRisky } from '@dropzy/shared';
import { Download, File, Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HttpError, api } from '../../lib/api';
import { duration, formatBytes, nextUtcMidnight, splitName } from '../../lib/format';
import { clickLink } from '../../lib/sink';
import { t } from '../../strings/en';

// The single-file page /f/{ref} (§9.4). Grab one file without opening the rest of the share.

export type Resolved = { name: string; mime?: string; thumb?: string };

function refFromPath(): string | null {
  const m = /^\/f\/([A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}

export default function SingleFile() {
  const [ref] = useState(refFromPath);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error' | 'missing_key' | 'capacity'>('loading');
  const [busy, setBusy] = useState(false);
  const [confirmRisky, setConfirmRisky] = useState(false);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!ref) {
      setState('gone');
      return;
    }
    api
      .fileMeta(ref)
      .then((m) => {
        setMeta(m);
        setState('ready');
      })
      .catch((e) => setState(e instanceof HttpError && e.code === 'at_capacity' ? 'capacity' : e instanceof HttpError && e.code === 'not_found' ? 'gone' : 'error'));
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [ref]);

  if (state === 'loading') {
    return (
      <Card>
        <Loader2 className="animate-spin text-accent" aria-hidden />
      </Card>
    );
  }
  if (state === 'gone' || !meta || !ref) return <End text={state === 'error' ? t.starting.failed : t.single.gone} />;
  if (state === 'capacity') return <End text={t.moments.atCapacity(nextUtcMidnight())} />;
  if (meta.e2ee) return <End text={t.moments.missingKey} />;

  const resolved: Resolved = { name: meta.name ?? 'file', mime: meta.mime, thumb: meta.thumb };
  const [base, ext] = splitName(resolved.name);

  const download = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { url } = await api.fileDownload(ref);
      clickLink(url);
      if (meta.burn) setState('gone');
    } catch (e) {
      const code = e instanceof HttpError ? e.code : '';
      setMsg(code === 'not_found' ? t.single.gone : code === 'rate_limited' ? t.moments.rateLimited : code === 'uploads_paused' ? t.moments.uploadsPaused : t.item.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t.single.title}</h1>
      <div className="size-40 overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800">
        {resolved.thumb ? (
          <img src={resolved.thumb} alt="" className="size-full object-cover" />
        ) : (
          <File size={48} className="m-auto mt-14 text-slate-400" aria-hidden />
        )}
      </div>
      <p className="flex max-w-full min-w-0 text-lg font-medium text-slate-900 dark:text-white" title={resolved.name}>
        <span className="truncate">{base}</span>
        <span className="shrink-0">{ext}</span>
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {formatBytes(meta.size)} · {t.single.from(`${meta.from.name} (${DEVICE_LABEL[meta.from.type]})`)}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {meta.burn ? t.item.burn : t.single.endsIn(duration(meta.expiresAt - now))}
      </p>
      {meta.e2ee && (
        <p className="flex items-center gap-1.5 text-sm text-live">
          <Lock size={14} aria-hidden />
          {t.status.e2ee}
        </p>
      )}
      {confirmRisky ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-amber-700 dark:text-amber-300">{t.item.risky}</p>
          <button type="button" className="btn-primary" onClick={download}>
            {t.item.riskyConfirm}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn-primary w-full max-w-xs"
          disabled={busy}
          onClick={() => (isRisky(resolved.name) ? setConfirmRisky(true) : download())}
        >
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} aria-hidden />}
          {t.single.download}
        </button>
      )}
      {msg && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {msg}
        </p>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="card mx-auto my-10 flex max-w-md flex-col items-center gap-3 p-8 text-center">{children}</section>;
}

function End({ text }: { text: string }) {
  return (
    <Card>
      <p className="text-lg text-slate-800 dark:text-slate-100">{text}</p>
      <a href="/" className="btn-primary">
        {t.single.openShare}
      </a>
    </Card>
  );
}
