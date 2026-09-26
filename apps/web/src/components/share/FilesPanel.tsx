import { type Item, SEARCH_THRESHOLD } from '@dropzy/shared';
import { Download, Flame, Search, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../lib/format';
import { startPicker } from '../../lib/sink';
import type { Transfer } from '../../lib/space';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { FileItem } from './FileItem';

export type FileRow = { id: string; item?: Item; transfer?: Transfer; createdAt: number };

export function FilesPanel() {
  const space = useSpace();
  const items = useApp((s) => s.items);
  const hidden = useApp((s) => s.hidden);
  const transfers = useApp((s) => s.transfers);
  const uploads = useApp((s) => s.space?.uploads ?? 'off');
  const burn = useApp((s) => s.burn);
  const plain = useApp((s) => s.plain);
  const [query, setQuery] = useState('');
  const onFiles = useCallback((f: File[]) => space.sendFiles(f), [space]);

  const files = items.filter((i) => i.type === 'file' && !hidden.includes(i.id));
  const rows: FileRow[] = files.map((i) => ({ id: i.id, item: i, transfer: transfers[i.id], createdAt: i.createdAt }));
  const serverIds = new Set(files.map((i) => i.id));
  for (const tr of Object.values(transfers)) {
    if (!serverIds.has(tr.id) && !hidden.includes(tr.id)) rows.push({ id: tr.id, transfer: tr, createdAt: space.localCreatedAt(tr.id) });
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);

  const q = query.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) => {
        const name = (r.item ? space.displayName(r.item) : r.transfer?.name) ?? '';
        return name.toLowerCase().includes(q) || r.item?.code?.toLowerCase() === q;
      })
    : rows;
  const zippable = space.zippable(files);
  void plain; // re-render when decrypted names arrive

  const direct = space.supportsDirect();
  const up = formatBytes(space.maxUpload).replace('.0', '');
  const hint = uploads === 'on' ? (direct ? t.files.hintBoth(up) : t.files.hintUploadOnly(up)) : t.files.hintDirectOnly;

  return (
    <section className="card flex flex-col" aria-labelledby="files-title">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-night-line">
        <h2 id="files-title" className="font-semibold text-slate-900 dark:text-white">
          {t.files.title}
        </h2>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-slate-500 sm:inline">
            <kbd>Ctrl</kbd> + <kbd>V</kbd>
          </span>
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
        </div>
      </header>
      <div className="flex flex-col gap-3 p-4">
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
        {rows.length > SEARCH_THRESHOLD && (
          <label className="relative">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.files.search}
              aria-label={t.files.search}
              className="input pl-9"
            />
          </label>
        )}
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t.files.empty}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-1 text-sm text-slate-500">{t.files.noMatches}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((r) => (
              <FileItem key={r.id} row={r} />
            ))}
          </ul>
        )}
      </div>
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
      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 px-4 py-6 text-center dark:border-slate-700">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent-strong dark:bg-accent/15 dark:text-accent">
          <Upload size={20} aria-hidden />
        </span>
        <p className="font-medium text-slate-800 dark:text-slate-100">
          <span className="hidden sm:inline">{t.files.drop}</span>
          <span className="sm:hidden">{t.files.tap}</span>
        </p>
        <button type="button" className="btn-primary" onClick={() => input.current?.click()}>
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
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/15 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-white px-10 py-8 text-lg font-semibold text-accent-strong shadow-xl dark:bg-night-card dark:text-accent">
            {t.files.dropOverlay}
          </div>
        </div>
      )}
    </>
  );
}
