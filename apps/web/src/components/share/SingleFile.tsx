import { DEVICE_LABEL, type FileMeta, IOS_DIRECT_CAP, isRisky } from '@dropzy/shared';
import { Download, File, Loader2, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HttpError, api } from '../../lib/api';
import { duration, formatBytes, nextUtcMidnight, splitName } from '../../lib/format';
import { decryptStream, fileKeys, openMeta, openThumb } from '../../lib/crypto/files';
import { keyFromHash } from '../../lib/crypto/keys';
import { isIOS } from '../../lib/device';
import { clickLink, openSink, pipeTo, saveBlob, startPicker } from '../../lib/sink';
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
  const [key] = useState(keyFromHash); // itemRoot for Private Share links (§10)
  const [resolved, setResolved] = useState<Resolved | null>(null);

  useEffect(() => {
    if (!ref) {
      setState('gone');
      return;
    }
    api
      .fileMeta(ref)
      .then(async (m) => {
        setMeta(m);
        if (!m.e2ee) {
          setResolved({ name: m.name ?? 'file', mime: m.mime, thumb: m.thumb });
          setState('ready');
          return;
        }
        if (!key) {
          setState('missing_key');
          return;
        }
        try {
          const keys = await fileKeys(key);
          const info = m.encMeta ? await openMeta(keys.meta, m.encMeta) : { name: 'file', mime: '' };
          const thumb = m.thumb ? await openThumb(keys.meta, m.thumb).catch(() => undefined) : undefined;
          setResolved({ ...info, thumb });
          setState('ready');
        } catch {
          setState('missing_key');
        }
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
  if (state === 'capacity') return <End text={t.moments.atCapacity(nextUtcMidnight())} />;
  if (state === 'missing_key') return <End text={t.moments.missingKey} />;
  if (state === 'gone' || !meta || !ref || !resolved) return <End text={state === 'error' ? t.starting.failed : t.single.gone} />;

  const [base, ext] = splitName(resolved.name);

  const download = async () => {
    // Pick the save target synchronously, inside the click (§9.5).
    const picker = meta.e2ee ? startPicker(resolved.name) : null;
    setBusy(true);
    setMsg('');
    try {
      if (meta.e2ee && isIOS() && meta.size > IOS_DIRECT_CAP) {
        setMsg(t.moments.tooBigIphone);
        return;
      }
      const { url } = await api.fileDownload(ref);
      if (meta.e2ee && key) {
        const { content } = await fileKeys(key);
        const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!res.ok || !res.body) throw new Error('download');
        const itemId = ref.split('.')[1];
        const sink = await openSink(resolved.name, picker, itemId, resolved.mime);
        const file = await pipeTo(res.body.pipeThrough(decryptStream(itemId, content, meta.size)), sink);
        if (file) saveBlob(file, resolved.name);
      } else {
        clickLink(url);
      }
      if (meta.burn) setState('gone');
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
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
