import { DEVICE_LABEL, DEVICE_NAME_MAX, type DeviceType, type Peer } from '@dropzy/shared';
import { Laptop, Monitor, Pencil, Send, Smartphone, Tablet } from 'lucide-react';
import { useRef, useState } from 'react';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog } from './Dialogs';

// Every device here by name; pick one to send it files directly (§9.2).
export function NearbyDevices() {
  const space = useSpace();
  const peers = useApp((s) => s.peers);
  const peerId = useApp((s) => s.peerId);
  const me = useApp((s) => s.me);
  const [renaming, setRenaming] = useState(false);

  const others = Array.isArray(peers) ? peers.filter((p) => p.peerId !== peerId) : [];
  // Two "iPhone"s look the same; a short tag from each one's id tells them apart.
  const count = new Map<string, number>();
  for (const p of others) count.set(p.name, (count.get(p.name) ?? 0) + 1);

  return (
    <section aria-labelledby="nearby-title" className="card flex flex-col gap-3 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h2 id="nearby-title" className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
            <span className="size-2 rounded-full bg-live" aria-hidden />
            {t.devices.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.devices.sub}</p>
        </div>
        <button
          type="button"
          onClick={() => setRenaming(true)}
          title={t.devices.tapToRename}
          className="group inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-accent/50 bg-accent-soft py-1 pr-3 pl-1.5 text-sm text-slate-900 dark:text-white"
        >
          <TypeIcon type={me.type} small />
          <span className="max-w-[12rem] truncate font-medium">{me.name}</span>
          <span className="opacity-75">· {t.devices.you}</span>
          <Pencil size={13} className="opacity-60 group-hover:opacity-100" aria-hidden />
        </button>
      </header>

      {!Array.isArray(peers) ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t.devices.busyCount(peers.count)}</p>
      ) : others.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t.devices.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {others.map((p) => (
            <li key={p.peerId}>
              <PeerTile peer={p} tag={(count.get(p.name) ?? 0) > 1 ? p.peerId.slice(-3).toUpperCase() : ''} onFiles={(f) => space.sendTo(f, p)} />
            </li>
          ))}
        </ul>
      )}

      {renaming && (
        <RenameDialog
          current={me.name}
          onClose={() => setRenaming(false)}
          onSave={async (n) => {
            if (await space.rename(n)) setRenaming(false);
          }}
        />
      )}
    </section>
  );
}

function PeerTile({ peer, tag, onFiles }: { peer: Peer; tag: string; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const off = peer.direct === false;

  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (off || !e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation(); // not the page-wide drop zone
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (off) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const files = [...e.dataTransfer.files];
          if (files.length) onFiles(files);
        }}
        disabled={off}
        title={off ? t.devices.cantReceive : t.devices.sendTo(peer.name)}
        aria-label={off ? `${peer.name}: ${t.devices.cantReceive}` : t.devices.sendTo(peer.name)}
        className={`group flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          over
            ? 'border-accent bg-accent-soft'
            : 'border-slate-200 bg-white hover:border-accent/60 hover:bg-accent-soft dark:border-night-line dark:bg-night-card'
        }`}
      >
        <span className="relative">
          <TypeIcon type={peer.type} />
          {!off && (
            <span className="absolute -right-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full bg-accent text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Send size={11} aria-hidden />
            </span>
          )}
        </span>
        <span className="w-full truncate text-sm font-medium text-slate-900 dark:text-white">
          {peer.name}
          {tag && <span className="ml-1 font-mono text-xs text-slate-500">#{tag}</span>}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {over ? t.devices.dropHere : off ? t.devices.cantReceive : peer.name === DEVICE_LABEL[peer.type] ? t.devices.tapToSend : DEVICE_LABEL[peer.type]}
        </span>
      </button>
      {/* Outside the button: a click on the input would bubble back up and open the picker again. */}
      <input
        ref={input}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

const ICONS: Record<DeviceType, typeof Smartphone> = {
  iphone: Smartphone,
  android: Smartphone,
  ipad: Tablet,
  windows: Monitor,
  linux: Monitor,
  mac: Laptop,
  chromeos: Laptop,
  other: Monitor,
};

export function TypeIcon({ type, small, tiny }: { type: DeviceType; small?: boolean; tiny?: boolean }) {
  const Icon = ICONS[type] ?? Monitor;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-accent-soft text-accent-ink dark:bg-slate-800 dark:text-accent ${tiny ? 'size-6' : small ? 'size-7' : 'size-11'}`}
      aria-hidden
    >
      <Icon size={tiny ? 13 : small ? 15 : 22} />
    </span>
  );
}

export function RenameDialog({ current, onClose, onSave }: { current: string; onClose: () => void; onSave: (name: string) => void }) {
  const [value, setValue] = useState(current);
  const valid = value.trim().length >= 1 && value.trim().length <= DEVICE_NAME_MAX;
  return (
    <Dialog open onClose={onClose} title={t.devices.renameTitle}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(value.trim());
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t.devices.renameLabel}
          <input className="input" value={value} maxLength={DEVICE_NAME_MAX} onChange={(e) => setValue(e.target.value)} autoFocus />
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
