import { useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../strings/en';
import { Dialog } from './Dialogs';

type Reason = keyof typeof t.report.reasons;

/** Report a file (§14.7). `ref` is the single-file ref (space ref + "." + item id). */
export function ReportDialog({ fileRef, onClose, onDone }: { fileRef: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = useState<Reason>('illegal');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={t.report.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.report(fileRef, reason, note.trim() || undefined);
            onDone(t.report.thanks);
            onClose();
          } catch {
            onDone(t.item.failed);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t.report.reason}</legend>
          {(Object.keys(t.report.reasons) as Reason[]).map((r) => (
            <label key={r} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
              <input type="radio" name="reason" className="size-4 accent-accent" checked={reason === r} onChange={() => setReason(r)} />
              {t.report.reasons[r]}
            </label>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t.report.note}
          <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t.devices.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {t.report.send}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
