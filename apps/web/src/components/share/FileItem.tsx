import { type Item, isImage, isRisky, isVideo } from '@dropzy/shared';
import { Download, File, FileArchive, FileAudio, FileImage, FileText, FileVideo, Link2, Lock, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { ago, duration, formatBytes, speed, splitName } from '../../lib/format';
import { startPicker } from '../../lib/sink';
import type { Transfer } from '../../lib/space';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog } from './Dialogs';
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

  const mine = item ? item.mine : transfer?.kind !== 'recv';
  const from = mine ? t.item.you : (item?.from.name ?? transfer?.peer ?? '');
  const ready = item?.status === 'ready';

  const download = () => {
    if (!item) return;
    const picker = item.e2ee ? startPicker(name) : null; // synchronously, inside the click
    void space.download(item, picker);
  };

  const canPreview = !!item && ready && !item.burn && !item.e2ee && (isImage(mime) || isVideo(mime));

  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/40">
      <button
        type="button"
        disabled={!canPreview}
        onClick={async () => item && setPreview(await space.downloadUrl(item).catch(() => null))}
        className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-white enabled:cursor-zoom-in dark:bg-slate-800"
        aria-label={canPreview ? `${t.item.preview}: ${name}` : name}
      >
        {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <TypeIcon mime={mime} name={name} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 font-medium text-slate-900 dark:text-white" title={name}>
          <span className="truncate">{base}</span>
          <span className="shrink-0">{ext}</span>
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
          {item?.e2ee && <Lock size={12} aria-label={t.item.encrypted} />}
          {item?.code && (
            <span className="rounded bg-slate-200/70 px-1.5 font-mono text-[11px] dark:bg-slate-700" title={t.item.code}>
              {item.code}
            </span>
          )}
          <span>{formatBytes(size)}</span>
          <span>· {t.item.from(from)}</span>
          {item && <span>· {ago(item.createdAt, now)}</span>}
        </p>
        <StatusLine item={item} transfer={transfer} now={now} />
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {transfer && transfer.kind !== 'recv' && transfer.state === 'active' && (
            <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => space.cancelUpload(transfer.id)}>
              <X size={14} aria-hidden />
              {t.item.cancel}
            </button>
          )}
          {!item && transfer?.kind === 'recv' && transfer.state === 'done' && (
            <>
              <button type="button" className="btn-secondary min-h-9 px-3 text-xs" onClick={() => space.saveReceived(transfer.id)}>
                <Download size={14} aria-hidden />
                {transfer.saved ? t.item.saved : t.item.save}
              </button>
              <SaveToPhotos
                mime={mime}
                ready={space.received.get(transfer.id)}
                load={async () => space.received.get(transfer.id) as File}
                onError={(m) => space.toast(m)}
              />
            </>
          )}
          {item && ready && (
            <>
              <button
                type="button"
                className="btn-secondary min-h-9 px-3 text-xs"
                onClick={() => (!item.mine && isRisky(name) ? setRisky(true) : download())}
              >
                <Download size={14} aria-hidden />
                {t.item.download}
              </button>
              <SaveToPhotos mime={mime} load={(onPct) => space.fetchFile(item, onPct)} onError={(m) => space.toast(m)} />
              {!item.burn && (
                <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => space.copyFileLink(item)}>
                  <Link2 size={14} aria-hidden />
                  {t.item.copyLink}
                </button>
              )}
            </>
          )}
          <FileMenu row={row} />
          {item && space.canDelete(item) && (
            <button type="button" className="btn-icon ml-auto size-9" onClick={() => space.deleteItem(item.id)} aria-label={t.item.delete}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
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

function StatusLine({ item, transfer, now }: { item?: Item; transfer?: Transfer; now: number }) {
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
  if (item.burn) return <p className={cls}>{t.item.burn}</p>;
  return <p className={cls}>{t.item.availableFor(duration(item.expiresAt - now))}</p>;
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
