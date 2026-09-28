import { Pencil, UserPen, Users } from 'lucide-react';
import { useState } from 'react';
import { hasChosenName } from '../../lib/device';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { RenameDialog, TypeIcon } from './NearbyDevices';

// Room card: who's here right now, and your own name (tap to add or change it).
export function RoomPeople() {
  const space = useSpace();
  const peers = useApp((s) => s.peers);
  const peerId = useApp((s) => s.peerId);
  const me = useApp((s) => s.me);
  const [renaming, setRenaming] = useState(false);
  // Re-read after a rename: the store's `me` changes, which re-renders this.
  const named = hasChosenName();

  const list = Array.isArray(peers) ? peers : [];
  const others = list.filter((p) => p.peerId !== peerId);
  const total = Array.isArray(peers) ? others.length + 1 : peers.count;

  const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-xs';
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-start" aria-live="polite">
      <span className="mr-0.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <Users size={14} className="text-accent" aria-hidden />
        {t.devices.roomTitle(total)}
      </span>
      <button
        type="button"
        onClick={() => setRenaming(true)}
        title={named ? t.devices.tapToRename : t.devices.addName}
        className={`group cursor-pointer border-accent/50 bg-accent-soft text-slate-900 dark:text-white ${chip}`}
      >
        <TypeIcon type={me.type} tiny />
        <span className="max-w-[8rem] truncate font-medium">{named ? me.name : t.devices.addName}</span>
        {named && <span className="opacity-75">· {t.devices.you}</span>}
        {named ? (
          <Pencil size={11} className="opacity-60 group-hover:opacity-100" aria-hidden />
        ) : (
          <UserPen size={12} className="opacity-80" aria-hidden />
        )}
      </button>
      {others.map((p) => (
        <span key={p.peerId} className={`border-slate-200 bg-white text-slate-900 dark:border-night-line dark:bg-night-card dark:text-white ${chip}`}>
          <TypeIcon type={p.type} tiny />
          <span className="max-w-[8rem] truncate font-medium">{p.name}</span>
        </span>
      ))}
      {renaming && (
        <RenameDialog
          current={named ? me.name : ''}
          onClose={() => setRenaming(false)}
          onSave={async (n) => {
            if (await space.rename(n)) setRenaming(false);
          }}
        />
      )}
    </div>
  );
}
