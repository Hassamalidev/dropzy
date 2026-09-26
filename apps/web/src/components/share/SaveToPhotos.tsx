import { isImage, isVideo } from '@dropzy/shared';
import { ImageDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { isIOS } from '../../lib/device';
import { t } from '../../strings/en';

// Save to Photos on iPhone/iPad (§9.5). navigator.share({files}) must run inside the tap with the
// File already in hand: if it's ready we share at once, otherwise the first tap fetches it (with
// progress) and the button becomes "Tap to save".

export function canSaveToPhotos(mime?: string): boolean {
  if (typeof navigator === 'undefined' || !isIOS() || !(isImage(mime) || isVideo(mime))) return false;
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

export function SaveToPhotos({
  mime,
  ready,
  load,
  onError,
  className = 'btn-ghost min-h-9 px-2.5 text-xs',
}: {
  mime?: string;
  /** A File that's already available (directly received). */
  ready?: File;
  /** Fetch the file, reporting 0–100. */
  load: (onPct: (pct: number) => void) => Promise<File>;
  onError: (msg: string) => void;
  className?: string;
}) {
  const [file, setFile] = useState<File | null>(ready ?? null);
  const [pct, setPct] = useState<number | null>(null);
  if (!canSaveToPhotos(mime)) return null;

  const share = (f: File) => {
    navigator.share({ files: [f] }).catch((e) => {
      if (e?.name !== 'AbortError') onError(t.item.failed);
    });
  };

  return (
    <button
      type="button"
      className={className}
      disabled={pct !== null}
      onClick={() => {
        const f = ready ?? file;
        if (f) {
          share(f); // inside the tap
          return;
        }
        setPct(0);
        load((p) => setPct(p))
          .then((got) => {
            if (navigator.canShare({ files: [got] })) setFile(got);
            else onError(t.moments.tooBigIphone);
          })
          .catch(() => onError(t.item.failed))
          .finally(() => setPct(null));
      }}
    >
      {pct !== null ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImageDown size={14} aria-hidden />}
      {pct !== null ? t.item.preparing(pct) : file && !ready ? t.item.tapToSave : t.item.saveToPhotos}
    </button>
  );
}

export { readWithProgress } from '../../lib/sink';
