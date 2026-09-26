import { EXPIRY_WARNING, type Item, TEXT_QR_MAX } from '@dropzy/shared';
import { Check, Copy, Lock, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { ago, duration } from '../../lib/format';
import { Linkified } from '../../lib/linkify';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { Dialog, Qr } from './Dialogs';
import { Code } from './FileItem';

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
  const soon = item.expiresAt - now <= EXPIRY_WARNING;

  return (
    <li className="group rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700/70 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {item.e2ee && <Lock size={12} className="shrink-0" aria-label={t.item.encrypted} />}
          {item.code && <Code code={item.code} />}
          <span className={`truncate ${soon ? 'font-medium text-accent-ink' : ''}`}>{t.item.expiresIn(duration(item.expiresAt - now))}</span>
          {!item.mine && <span className="hidden truncate sm:inline">· {t.item.from(item.from.name)}</span>}
        </p>
        <div className="flex shrink-0 items-center">
          <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">{ago(item.createdAt, now)}</span>
          <button
            type="button"
            className="btn-icon size-9"
            disabled={!text}
            aria-label={copied ? t.text.copied : t.text.copy}
            title={copied ? t.text.copied : t.text.copy}
            onClick={async () => {
              if (!text) return;
              const ok = await copyText(text);
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } else space.toast(t.toast.copyFailed);
            }}
          >
            {copied ? <Check size={15} className="text-accent-ink" aria-hidden /> : <Copy size={15} aria-hidden />}
          </button>
          {text && text.length <= TEXT_QR_MAX && (
            <button type="button" className="btn-icon size-9" onClick={() => setQr(true)} aria-label={t.text.qrTitle} title={t.text.qrTitle}>
              <QrCode size={15} aria-hidden />
            </button>
          )}
          {space.canDelete(item) && (
            <button type="button" className="btn-icon size-9" onClick={() => space.deleteItem(item.id)} aria-label={t.item.delete} title={t.item.delete}>
              <Trash2 size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>
      <div
        className={`mt-1 text-sm leading-6 break-words whitespace-pre-wrap text-slate-800 dark:text-slate-100 ${long && !expanded ? 'line-clamp-[8]' : ''}`}
      >
        {text === undefined ? (
          <span className="text-slate-500">{plain?.failed ? t.moments.generic : '…'}</span>
        ) : (
          <Linkified text={text} />
        )}
      </div>
      {long && (
        <button type="button" className="link mt-1 cursor-pointer text-xs" onClick={() => setExpanded((x) => !x)}>
          {expanded ? t.text.showLess : t.text.showMore}
        </button>
      )}
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
