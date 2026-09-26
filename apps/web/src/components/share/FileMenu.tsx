import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import type { FileRow } from './FilesPanel';
import { ReportDialog } from './ReportDialog';

type Action = { label: string; run: () => void };

/** Overflow menu: "Make available for later" (your directly sent items), "Report" (others' items). */
export function FileMenu({ row }: { row: FileRow }) {
  const space = useSpace();
  const uploads = useApp((s) => s.space?.uploads ?? 'off');
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const ref0 = useApp((s) => s.space?.ref);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const actions: Action[] = [];
  const tr = row.transfer;
  if (!row.item && tr?.kind === 'send' && tr.state === 'done' && uploads === 'on' && space.localFiles.has(row.id)) {
    actions.push({ label: t.item.makeAvailable, run: () => void space.makeAvailable(row.id) });
  }
  if (row.item && !row.item.mine && row.item.type === 'file' && ref0) {
    actions.push({ label: t.item.report, run: () => setReporting(true) });
  }
  if (!actions.length) return null;

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn-icon size-9" aria-label={t.item.more} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 min-w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 dark:border-slate-700 dark:bg-slate-800">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              className="block min-h-11 w-full cursor-pointer px-4 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
              onClick={() => {
                setOpen(false);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {reporting && row.item && ref0 && (
        <ReportDialog fileRef={`${ref0}.${row.item.id}`} onClose={() => setReporting(false)} onDone={(m) => space.toast(m)} />
      )}
    </div>
  );
}
