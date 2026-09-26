import { type Item, TEXT_QR_MAX } from '@dropzy/shared';
import { Check, Copy, Lock, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { ago } from '../../lib/format';
import { Linkified } from '../../lib/linkify';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog, Qr } from './Dialogs';

const MAX_LINES = 8;

export function TextItem({ item }: { item: Item }) {
  const space = useSpace();
  const now = useApp((s) => s.now);
  const plain = useApp((s) => s.plain[item.id]);
  const text = item.e2ee ? plain?.body : item.body;
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [qr, setQr] = useState(false);

  const long = !!text && (text.split('\n').length > MAX_LINES || text.length > 700);
  const from = item.mine ? t.item.you : item.from.name;

  return (
    <li className="group rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700/70 dark:bg-slate-900/40">
      <div
        className={`text-sm leading-6 break-words whitespace-pre-wrap text-slate-800 dark:text-slate-100 ${long && !expanded ? 'line-clamp-[8]' : ''}`}
      >
        {text === undefined ? (
          <span className="text-slate-400">{plain?.failed ? t.moments.generic : '…'}</span>
        ) : (
          <Linkified text={text} />
        )}
      </div>
      {long && (
        <button type="button" className="link mt-1 cursor-pointer text-xs" onClick={() => setExpanded((x) => !x)}>
          {expanded ? t.text.showLess : t.text.showMore}
        </button>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
          {item.e2ee && <Lock size={12} aria-label={t.item.encrypted} />}
          {item.code && <span className="rounded bg-slate-200/70 px-1.5 font-mono text-[11px] dark:bg-slate-700">{item.code}</span>}
          <span className="truncate">
            {t.item.from(from)} · {ago(item.createdAt, now)}
          </span>
        </p>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className="btn-ghost min-h-9 px-2.5 text-xs"
            disabled={!text}
            onClick={async () => {
              if (!text) return;
              const ok = await copyText(text);
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } else space.toast(t.toast.copyFailed);
            }}
          >
            {copied ? <Check size={14} className="text-live" aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? t.text.copied : t.text.copy}
          </button>
          {text && text.length <= TEXT_QR_MAX && (
            <button type="button" className="btn-ghost min-h-9 px-2.5 text-xs" onClick={() => setQr(true)}>
              <QrCode size={14} aria-hidden />
              {t.text.qr}
            </button>
          )}
          {space.canDelete(item) && (
            <button type="button" className="btn-icon size-9" onClick={() => space.deleteItem(item.id)} aria-label={t.item.delete}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {qr && text && (
        <Dialog open onClose={() => setQr(false)} title={t.text.qrTitle}>
          <div className="flex justify-center">
            <Qr text={text} size={260} label={t.text.qrTitle} />
          </div>
        </Dialog>
      )}
    </li>
  );
}
