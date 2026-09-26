import { DEVICE_LABEL, DEVICE_NAME_MAX, MAX_PEERS_SHOWN, type Peer, emojiFor } from '@dropzy/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog } from './Dialogs';

// Friendly device names and presence (§6.3.2).
export function DevicesBar() {
  const space = useSpace();
  const peers = useApp((s) => s.peers);
  const me = useApp((s) => s.peerId);
  const myName = useApp((s) => s.me.name);
  const [renaming, setRenaming] = useState(false);
  const viaPass = useApp((s) => !!s.space?.viaPass);

  if (!Array.isArray(peers)) {
    return (
      <div className="flex min-h-10 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span className="size-2 rounded-full bg-live" aria-hidden />
        {t.devices.busyCount(peers.count)}
      </div>
    );
  }

  const mine = peers.find((p) => p.peerId === me);
  const others = peers.filter((p) => p.peerId !== me);
  const shown = others.slice(0, MAX_PEERS_SHOWN - 1);
  const extra = others.length - shown.length;

  return (
    <section aria-label={t.devices.label} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <h2 className="sr-only">{t.devices.label}</h2>
      <span className="mr-1 flex items-center gap-2 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <span className="size-2 rounded-full bg-live" aria-hidden />
        {t.devices.label}
      </span>
      {mine && (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          title={t.devices.tapToRename}
          className="group inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-accent/50 bg-accent-soft py-1 pr-3 pl-1.5 text-sm text-slate-900 dark:text-white"
        >
          <Avatar name={myName} />
          <span className="font-medium">{myName}</span>
          <span className="opacity-75">
            · {DEVICE_LABEL[mine.type]} {t.devices.you}
          </span>
          <Pencil size={13} className="opacity-60 group-hover:opacity-100" aria-hidden />
        </button>
      )}
      {shown.map((p) => (
        <PeerChip key={p.peerId} peer={p} />
      ))}
      {extra > 0 && <span className="chip">{t.devices.more(extra)}</span>}
      {viaPass && (
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {t.connect.connectedByCode} ·
          <button type="button" className="link cursor-pointer" onClick={() => space.leavePass()}>
            {t.connect.leave}
          </button>
        </span>
      )}
      {renaming && (
        <RenameDialog
        open
        current={myName}
        onClose={() => setRenaming(false)}
        onSave={async (n) => {
          if (await space.rename(n)) setRenaming(false);
        }}
        />
      )}
    </section>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-full bg-slate-100 text-base dark:bg-slate-800" aria-hidden>
      {emojiFor(name)}
    </span>
  );
}

function PeerChip({ peer }: { peer: Peer }) {
  return (
    <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pr-3 pl-1.5 text-sm dark:border-slate-700 dark:bg-night-card">
      <Avatar name={peer.name} />
      <span className="font-medium">{peer.name}</span>
      <span className="text-slate-500 dark:text-slate-400">· {DEVICE_LABEL[peer.type]}</span>
    </span>
  );
}

function RenameDialog({
  open,
  current,
  onClose,
  onSave,
}: {
  open: boolean;
  current: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(current);
  const valid = value.trim().length >= 1 && value.trim().length <= DEVICE_NAME_MAX;
  return (
    <Dialog open={open} onClose={onClose} title={t.devices.renameTitle}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(value.trim());
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t.devices.renameLabel}
          <input
            className="input"
            value={value}
            maxLength={DEVICE_NAME_MAX}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{t.devices.renameHint}</span>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t.devices.cancel}
          </button>
          <button type="submit" className="btn-primary" disabled={!valid}>
            {t.devices.save}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
