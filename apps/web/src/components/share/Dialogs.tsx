import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { qrDataUrl } from '../../lib/qr';
import { t } from '../../strings/en';

/**
 * Native <dialog>: showModal() traps focus and Esc closes it. We also close on backdrop
 * click and ×, and restore focus to whatever opened it (§6.3).
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={() => {
        onClose();
        (opener.current as HTMLElement | null)?.focus?.();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 dark:border-night-line dark:bg-night-card dark:text-slate-100`}
      style={{ width: `min(92vw, ${wide ? 560 : 420}px)` }}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" className="btn-icon -mr-2" onClick={onClose} aria-label={t.feature.close}>
              <X size={18} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A QR code rendered from a lazily loaded generator. Always dark-on-white with a quiet zone. */
export function Qr({ text, size = 180, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    qrDataUrl(text).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [text]);
  return (
    <div className="shrink-0 overflow-hidden rounded-xl bg-white" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} width={size} height={size} alt={label} className="block" />
      ) : (
        <div className="size-full animate-pulse bg-slate-100" />
      )}
    </div>
  );
}
