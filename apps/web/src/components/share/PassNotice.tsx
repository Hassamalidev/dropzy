import { t } from '../../strings/en';
import { useApp, useSpace } from './context';

/** A device that joined by pair code or QR, not by network detection, can leave that network here (§7.1). */
export function PassNotice() {
  const space = useSpace();
  const viaPass = useApp((s) => !!s.space?.viaPass);
  if (!viaPass) return null;
  return (
    <p className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      <span className="size-2 rounded-full bg-live" aria-hidden />
      {t.connect.connectedByCode} ·
      <button type="button" className="link cursor-pointer" onClick={() => space.leavePass()}>
        {t.connect.leave}
      </button>
    </p>
  );
}
