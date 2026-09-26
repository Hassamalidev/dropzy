import { EXPIRY_WARNING, type Item, isImage, isRisky, isVideo } from '@dropzy/shared';
import { Check, Download, File, FileArchive, QrCode, FileAudio, FileImage, FileText, FileVideo, Link2, Lock, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ago, duration, formatBytes, speed, splitName } from '../../lib/format';
import { startPicker } from '../../lib/sink';
import type { Transfer } from '../../lib/space';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog, Qr } from './Dialogs';
import type { FileRow } from './FilesPanel';
import { FileMenu } from './FileMenu';
import { SaveToPhotos } from './SaveToPhotos';

export function FileItem({ row }: { row: FileRow }) {
  const space = useSpace();
  const now = useApp((s) => s.now);
  useApp((s) => (row.item ? s.plain[row.item.id] : null));
  const { item, transfer } = row;
  const name = item ? space.displayName(item) : (transfer?.name ?? 'file');
  const mime = item ? space.displayMime(item) : transfer?.mime;
  const thumb = item ? space.displayThumb(item) : space.localThumb(row.id);
  const size = item?.size ?? transfer?.size ?? 0;
  const [base, ext] = splitName(name);
  const [risky, setRisky] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const mine = item ? item.mine : transfer?.kind !== 'recv';
  const from = mine ? t.item.you : (item?.from.name ?? transfer?.peer ?? '');
  const ready = item?.status === 'ready';

  const download = () => {
    if (!item) return;
    const picker = item.e2ee ? startPicker(name) : null; // synchronously, inside the click
    void space.download(item, picker);
  };

  const canPreview = !!item && ready && !item.burn && !item.e2ee && (isImage(mime) || isVideo(mime));

  const soon = !!item && ready && !item.burn && item.expiresAt - now <= EXPIRY_WARNING;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/70 dark:bg-slate-900/40">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canPreview}
          onClick={async () => item && setPreview(await space.downloadUrl(item).catch(() => null))}
          className="relative flex size-11 shrink-0 overflow-hidden rounded-lg bg-slate-100 enabled:cursor-zoom-in dark:bg-slate-800"
          aria-label={canPreview ? `${t.item.preview}: ${name}` : name}
        >
          {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <TypeIcon mime={mime} name={name} />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex min-w-0 items-center gap-2">
            <span className="flex min-w-0 font-medium text-slate-900 dark:text-white" title={name}>
              <span className="truncate">{base}</span>
              <span className="shrink-0">{ext}</span>
            </span>
            {item?.code && <Code code={item.code} />}
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
            {item?.e2ee && <Lock size={12} aria-label={t.item.encrypted} />}
            <span>{formatBytes(size)}</span>
            {!mine && <span>· {t.item.from(from)}</span>}
            {item && <span>· {ago(item.createdAt, now)}</span>}
            {item && ready && (
              <span className={soon ? 'font-medium text-accent-ink' : undefined}>
                · {item.burn ? t.item.burn : t.item.expiresIn(duration(item.expiresAt - now))}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {transfer && transfer.kind !== 'recv' && transfer.state === 'active' && (
            <button type="button" className="btn-icon size-9" onClick={() => space.cancelUpload(transfer.id)} aria-label={t.item.cancel} title={t.item.cancel}>
              <X size={16} aria-hidden />
            </button>
          )}
          {!item && transfer?.kind === 'recv' && transfer.state === 'done' && (
            <>
              <SaveToPhotos
                mime={mime}
                ready={space.received.get(transfer.id)}
                load={async () => space.received.get(transfer.id) as File}
                onError={(m) => space.toast(m)}
              />
              <button
                type="button"
                className="btn-icon size-9 text-accent-ink"
                onClick={() => space.saveReceived(transfer.id)}
                aria-label={transfer.saved ? t.item.saved : t.item.save}
                title={transfer.saved ? t.item.saved : t.item.save}
              >
                {transfer.saved ? <Check size={16} aria-hidden /> : <Download size={16} aria-hidden />}
              </button>
            </>
          )}
          {item && ready && (
            <>
              <SaveToPhotos mime={mime} load={(onPct) => space.fetchFile(item, onPct)} onError={(m) => space.toast(m)} />
              {!item.burn && (
                <>
                  <button type="button" className="btn-icon size-9" onClick={() => space.copyFileLink(item)} aria-label={t.item.copyLink} title={t.item.copyLink}>
                    <Link2 size={16} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="btn-icon size-9"
                    onClick={async () => setQr(await space.fileLink(item, { autoDownload: true }))}
                    aria-label={t.item.qr}
                    title={t.item.qr}
                  >
                    <QrCode size={16} aria-hidden />
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-icon size-9 text-accent-ink"
                onClick={() => (!item.mine && isRisky(name) ? setRisky(true) : download())}
                aria-label={t.item.download}
                title={t.item.download}
              >
                <Download size={16} aria-hidden />
              </button>
            </>
          )}
          <FileMenu row={row} />
          {!item && transfer && transfer.state === 'done' && (
            <button type="button" className="btn-icon size-9" onClick={() => space.deleteLocal(transfer.id)} aria-label={t.item.delete} title={t.item.delete}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
          {item && space.canDelete(item) && (
            <button type="button" className="btn-icon size-9" onClick={() => space.deleteItem(item.id)} aria-label={t.item.delete} title={t.item.delete}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
      <StatusLine item={item} transfer={transfer} />
      {risky && (
        <Dialog open onClose={() => setRisky(false)} title={t.item.riskyTitle}>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.item.risky}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setRisky(false)}>
              {t.devices.cancel}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setRisky(false);
                download();
              }}
            >
              {t.item.riskyConfirm}
            </button>
          </div>
        </Dialog>
      )}
      {qr && (
        <Dialog open onClose={() => setQr(null)} title={t.item.qrTitle}>
          <div className="flex flex-col items-center gap-3 text-center">
            <Qr text={qr} size={240} label={t.item.qrTitle} />
            <p className="max-w-full truncate text-sm font-medium text-slate-900 dark:text-white" title={name}>
              {name}
            </p>
            {item?.code && (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {t.item.orCode}{' '}
                <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-base font-semibold tracking-widest text-slate-900 dark:bg-slate-800 dark:text-white">
                  {item.code}
                </span>{' '}
                {t.item.inPrivate}
              </p>
            )}
          </div>
        </Dialog>
      )}
      {preview && (
        <Dialog open onClose={() => setPreview(null)} title={name} wide>
          {isVideo(mime) ? (
            // biome-ignore lint/a11y/useMediaCaption: user content has no captions
            <video src={preview} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black" />
          ) : (
            <img src={preview} alt={name} className="max-h-[70vh] w-full rounded-lg object-contain" />
          )}
        </Dialog>
      )}
    </li>
  );
}

/** The item's search code: find it on busy networks, or read it out to someone. */
export function Code({ code }: { code: string }) {
  return (
    <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300" title={t.item.code}>
      {code}
    </span>
  );
}

/** Progress and direct-transfer states. Ready items say everything in the meta line. */
function StatusLine({ item, transfer }: { item?: Item; transfer?: Transfer }) {
  const cls = 'text-xs text-slate-600 dark:text-slate-300';
  if (transfer && transfer.state === 'active') {
    const pct = transfer.size ? Math.floor((transfer.loaded / transfer.size) * 100) : 0;
    const text =
      transfer.kind === 'upload'
        ? t.item.uploading(pct, speed(transfer.speed))
        : transfer.kind === 'send'
          ? t.item.sendingDirect(pct, speed(transfer.speed))
          : t.item.receiving(transfer.peer ?? '', pct);
    return (
      <div className="flex flex-col gap-1" aria-live="polite">
        <p className={cls}>{text}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (transfer && transfer.state === 'done') {
    return <p className={cls}>{transfer.kind === 'send' ? t.item.sentDirect(transfer.peer ?? '') : t.item.received(transfer.peer ?? '')}</p>;
  }
  if (!item) return <p className={cls}>{t.item.waiting}</p>;
  if (item.status === 'uploading') {
    return <p className={cls}>{item.mine ? t.item.waiting : t.item.othersUploading(item.from.name, item.pct ?? 0)}</p>;
  }
  return null;
}

function TypeIcon({ mime = '', name }: { mime?: string; name: string }) {
  const cls = 'm-auto text-slate-400';
  const p = { size: 24, className: cls, 'aria-hidden': true } as const;
  if (mime.startsWith('image/')) return <FileImage {...p} />;
  if (mime.startsWith('video/')) return <FileVideo {...p} />;
  if (mime.startsWith('audio/')) return <FileAudio {...p} />;
  if (/zip|compressed|tar|gzip|7z|rar/.test(mime) || /\.(zip|7z|rar|gz|tar)$/i.test(name)) return <FileArchive {...p} />;
  if (mime.startsWith('text/') || /pdf|document|sheet|presentation/.test(mime)) return <FileText {...p} />;
  return <File {...p} />;
}
