import type { Item } from '@dropzy/shared';
import { Download, Flame, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBytes, isMac } from '../../lib/format';
import { startPicker } from '../../lib/sink';
import type { Transfer } from '../../lib/space';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { FileItem } from './FileItem';
import { Keys } from './Keys';
import { matches } from './SearchBar';

export type FileRow = { id: string; item?: Item; transfer?: Transfer; createdAt: number };

export function FilesPanel({ query }: { query: string }) {
  const space = useSpace();
  const mode = useApp((s) => s.mode);
  const items = useApp((s) => s.items);
  const hidden = useApp((s) => s.hidden);
  const transfers = useApp((s) => s.transfers);
  const uploads = useApp((s) => s.space?.uploads ?? 'off');
  const burn = useApp((s) => s.burn);
  const plain = useApp((s) => s.plain);
  const onFiles = useCallback((f: File[]) => space.sendFiles(f), [space]);

  const files = items.filter((i) => i.type === 'file' && !hidden.includes(i.id));
  const rows: FileRow[] = files.map((i) => ({ id: i.id, item: i, transfer: transfers[i.id], createdAt: i.createdAt }));
  const serverIds = new Set(files.map((i) => i.id));
  for (const tr of Object.values(transfers)) {
    if (!serverIds.has(tr.id) && !hidden.includes(tr.id)) rows.push({ id: tr.id, transfer: tr, createdAt: space.localCreatedAt(tr.id) });
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);

  const shown = rows.filter((r) =>
    matches(query, r.item ? space.displayName(r.item) : r.transfer?.name, r.item?.code, r.item?.from.name ?? r.transfer?.peer),
  );
  const zippable = space.zippable(files);
  void plain; // re-render when decrypted names arrive

  const direct = space.supportsDirect();
  const up = formatBytes(space.maxUpload).replace('.0', '');
  const hint = uploads === 'on' ? (direct ? t.files.hintBoth(up) : t.files.hintUploadOnly(up)) : t.files.hintDirectOnly;

  return (
    <section className="flex min-w-0 flex-col gap-4 p-4 sm:p-6" aria-labelledby="files-title">
      <header className="flex min-h-9 items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 id="files-title" className="font-semibold text-slate-900 dark:text-white">
            {t.files.title}
          </h2>
          <Keys keys={[isMac() ? '⌘' : 'Ctrl', 'V']} />
        </div>
        <div className="flex items-center gap-2">
          {zippable.length >= 2 && (
            <button
              type="button"
              className="btn-ghost min-h-9 px-2.5"
              onClick={() => {
                const picker = startPicker(t.files.zipName); // synchronously, inside the click
                void space.downloadAll(files, picker);
              }}
            >
              <Download size={16} aria-hidden />
              {t.files.downloadAll}
            </button>
          )}
          {rows.length > 0 && <span className="text-sm text-slate-500 dark:text-slate-400">{t.files.count(rows.length)}</span>}
        </div>
      </header>
      <DropZone hint={hint} onFiles={onFiles} />
      {uploads === 'on' && (
        <label className="chip cursor-pointer self-start py-1.5">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={burn}
            onChange={(e) => space.store.set({ burn: e.target.checked })}
          />
          <Flame size={14} aria-hidden />
          {t.files.burn}
        </label>
      )}
      {rows.length === 0 ? (
        <p className="px-1 text-sm text-slate-500 dark:text-slate-400">{t.files.empty[mode]}</p>
      ) : shown.length === 0 ? (
        <p className="px-1 text-sm text-slate-500 dark:text-slate-400">{t.files.noMatches}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <FileItem key={r.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DropZone({ hint, onFiles }: { hint: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Whole-window drag overlay, plus files from paste / "Paste & send".
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) onFiles(files);
    };
    const pasted = (e: Event) => onFiles((e as CustomEvent<File[]>).detail);
    addEventListener('dragenter', enter);
    addEventListener('dragleave', leave);
    addEventListener('dragover', overFn);
    addEventListener('drop', drop);
    addEventListener('dz:files', pasted);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragleave', leave);
      removeEventListener('dragover', overFn);
      removeEventListener('drop', drop);
      removeEventListener('dz:files', pasted);
    };
  }, [onFiles]);

  return (
    <>
      <div className="flex flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center transition-colors hover:border-accent/60 dark:border-slate-700">
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <Upload size={20} aria-hidden />
        </span>
        <p className="font-medium text-slate-800 dark:text-slate-100">
          <span className="hidden sm:inline">{t.files.drop}</span>
          <span className="sm:hidden">{t.files.tap}</span>
        </p>
        <button type="button" className="btn-secondary" onClick={() => input.current?.click()}>
          {t.files.choose}
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) onFiles(files);
          }}
        />
      </div>
      {over && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-white px-10 py-8 text-lg font-semibold text-accent-strong dark:bg-night-card dark:text-accent">
            {t.files.dropOverlay}
          </div>
        </div>
      )}
    </>
  );
}
