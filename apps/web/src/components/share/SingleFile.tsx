import { DEVICE_LABEL, type FileMeta, IOS_DIRECT_CAP, isRisky } from '@dropzy/shared';
import { Download, File, Loader2, Lock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { HttpError, api } from '../../lib/api';
import { duration, formatBytes, nextUtcMidnight, splitName } from '../../lib/format';
import { decryptStream, fileKeys, openMeta, openThumb } from '../../lib/crypto/files';
import { keyFromHash, newRelayKeys, openRoot } from '../../lib/crypto/keys';
import { isIOS } from '../../lib/device';
import { clickLink, openSink, pipeTo, saveBlob, startPicker } from '../../lib/sink';
import { t } from '../../strings/en';
import { ReportDialog } from './ReportDialog';
import { SaveToPhotos, readWithProgress } from './SaveToPhotos';

// The single-file page /f/{ref} (§9.4). Grab one file without opening the rest of the share.

export type Resolved = { name: string; mime?: string; thumb?: string };

/** Opened from a QR code or a file code (?dl=1): start the download by itself, once. */
function takeAutoDownload(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get('dl') !== '1') return false;
  history.replaceState(null, '', location.pathname + location.hash);
  return true;
}

function refFromPath(): string | null {
  const m = /^\/f\/([A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22})\/?$/.exec(location.pathname);
  return m ? m[1] : null;
}

export default function SingleFile() {
  const [ref] = useState(refFromPath);
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [state, setState] = useState<'loading' | 'asking' | 'ready' | 'gone' | 'error' | 'missing_key' | 'offline' | 'capacity'>('loading');
  const [busy, setBusy] = useState(false);
  const [confirmRisky, setConfirmRisky] = useState(false);
  const [msg, setMsg] = useState('');
  const [reporting, setReporting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [key, setKey] = useState(keyFromHash); // itemRoot for Private Share links (§10)
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [auto] = useState(takeAutoDownload); // before any early return: it reads the URL once
  const [attempt, setAttempt] = useState(0);
  const start = useRef<(() => void) | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (!ref) {
      setState('gone');
      return;
    }
    setState('loading');
    api
      .fileMeta(ref)
      .then(async (m) => {
        setMeta(m);
        if (!m.e2ee) {
          setResolved({ name: m.name ?? 'file', mime: m.mime, thumb: m.thumb });
          setState('ready');
          return;
        }
        let root = key;
        if (!root) {
          // Opened from a file code (or reloaded after): ask a device still open in the share for this file's key.
          setState('asking');
          try {
            const { keys, pub } = await newRelayKeys();
            const r = await api.fileKey(ref, pub);
            root = await openRoot(keys, ref.split('.')[1], r.pub, r.box);
            setKey(root);
          } catch (e) {
            setState(e instanceof HttpError && e.code === 'sender_offline' ? 'offline' : 'missing_key');
            return;
          }
        }
        try {
          const keys = await fileKeys(root);
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
  }, [ref, attempt]);

  useEffect(() => {
    if (!auto || state !== 'ready' || fired.current) return;
    fired.current = true;
    start.current?.();
  }, [auto, state]);

  if (state === 'loading' || state === 'asking') {
    return (
      <Card>
        <Loader2 className="animate-spin text-accent" aria-hidden />
        {state === 'asking' && <p className="text-sm text-slate-600 dark:text-slate-400">{t.single.asking}</p>}
      </Card>
    );
  }
  const retry = () => setAttempt((n) => n + 1);
  if (state === 'offline') return <End text={t.single.senderOffline} onRetry={retry} />;
  if (state === 'capacity') return <End text={t.moments.atCapacity(nextUtcMidnight())} />;
  if (state === 'missing_key') return <End text={t.moments.missingKey} />;
  if (state === 'error') return <End text={t.starting.failed} onRetry={retry} />;
  if (state === 'gone' || !meta || !ref || !resolved) return <End text={t.single.gone} />;

  const [base, ext] = splitName(resolved.name);

  const download = async (fromClick = true) => {
    // Pick the save target synchronously, inside the click (§9.5). An automatic start has no click to use.
    const picker = meta.e2ee && fromClick ? startPicker(resolved.name) : null;
    setBusy(true);
    setMsg('');
    try {
      if (meta.e2ee && isIOS() && meta.size > IOS_DIRECT_CAP) {
        setMsg(t.moments.tooBigIphone);
        return;
      }
      if (meta.e2ee && key) {
        // Where to save comes first: cancelling that dialog must not use up a one-download file.
        const itemId = ref.split('.')[1];
        const sink = await openSink(resolved.name, picker, itemId, resolved.mime);
        let body: ReadableStream<Uint8Array>;
        try {
          const { url } = await api.fileDownload(ref);
          const { content } = await fileKeys(key);
          const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!res.ok || !res.body) throw new Error('download');
          body = res.body.pipeThrough(decryptStream(itemId, content, meta.size));
        } catch (e) {
          await sink.abort();
          throw e;
        }
        const file = await pipeTo(body, sink);
        if (file) saveBlob(file, resolved.name);
      } else {
        clickLink((await api.fileDownload(ref)).url);
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

  // Risky types (.exe, …) still wait for the person to confirm.
  start.current = () => {
    if (!isRisky(resolved.name)) void download(false);
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
          <p className="text-sm text-slate-950 dark:text-accent">{t.item.risky}</p>
          <button type="button" className="btn-primary" onClick={() => download()}>
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
      {!confirmRisky && (
        <SaveToPhotos
          className="btn-secondary w-full max-w-xs"
          mime={resolved.mime}
          load={async (onPct) => {
            const { url } = await api.fileDownload(ref);
            const res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
            if (!res.ok || !res.body) throw new Error('download');
            let body: ReadableStream<Uint8Array> = res.body;
            if (meta.e2ee && key) {
              const { content } = await fileKeys(key);
              body = body.pipeThrough(decryptStream(ref.split('.')[1], content, meta.size));
            }
            const f = await readWithProgress(body, meta.size, resolved.name, resolved.mime, onPct);
            if (meta.burn) setState('gone');
            return f;
          }}
          onError={setMsg}
        />
      )}
      <button type="button" className="link cursor-pointer text-sm" onClick={() => setReporting(true)}>
        {t.single.report}
      </button>
      {reporting && <ReportDialog fileRef={ref} onClose={() => setReporting(false)} onDone={setMsg} />}
      {msg && (
        <p role="alert" className="text-sm text-slate-950 dark:text-accent">
          {msg}
        </p>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="card mx-auto my-10 flex max-w-md flex-col items-center gap-3 p-8 text-center">{children}</section>;
}

function End({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <Card>
      <p className="text-lg text-slate-800 dark:text-slate-100">{text}</p>
      {onRetry && (
        <button type="button" className="btn-primary" onClick={onRetry}>
          {t.single.retry}
        </button>
      )}
      <a href="/" className={onRetry ? 'link text-sm' : 'btn-primary'}>
        {t.single.openShare}
      </a>
    </Card>
  );
}
