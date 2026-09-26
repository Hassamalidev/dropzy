import { TEXT_MAX } from '@dropzy/shared';
import { ClipboardCopy, ClipboardPaste, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { session, setSession } from '../../lib/device';
import { isMac } from '../../lib/format';
import { t } from '../../strings/en';
import { useApp, useSpace } from './context';
import { TextItem } from './TextItem';

export function TextPanel() {
  const space = useSpace();
  const items = useApp((s) => s.items);
  const hidden = useApp((s) => s.hidden);
  const texts = items.filter((i) => i.type === 'text' && !hidden.includes(i.id));
  const draftKey = `dz-draft:${space.mode}:${space.token ?? 'wifi'}`;
  const [draft, setDraft] = useState(() => session(draftKey) ?? '');
  const [sending, setSending] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  // The draft survives failures and reloads (§6.3.5).
  useEffect(() => setSession(draftKey, draft || null), [draft, draftKey]);

  // Pasted text from the global Ctrl/⌘+V handler lands here (not auto-sent, §11).
  useEffect(() => {
    const onPaste = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setDraft((d) => (d ? `${d}\n${text}` : text));
      ta.current?.focus();
    };
    addEventListener('dz:paste-text', onPaste);
    return () => removeEventListener('dz:paste-text', onPaste);
  }, []);

  const share = async (text = draft) => {
    if (!text.trim() || sending) return;
    setSending(true);
    const ok = await space.addText(text);
    setSending(false);
    if (ok && text === draft) setDraft('');
  };

  const pasteAndSend = async () => {
    try {
      if (navigator.clipboard?.read) {
        const entries = await navigator.clipboard.read();
        for (const entry of entries) {
          const img = entry.types.find((x) => x.startsWith('image/'));
          if (img) {
            const blob = await entry.getType(img);
            const ext = img.split('/')[1] || 'png';
            dispatchEvent(new CustomEvent('dz:files', { detail: [new File([blob], `pasted-image.${ext}`, { type: img })] }));
            return;
          }
          if (entry.types.includes('text/plain')) {
            const text = await (await entry.getType('text/plain')).text();
            if (text.trim()) await share(text);
            return;
          }
        }
      }
      const text = await navigator.clipboard.readText();
      if (text.trim()) await share(text);
      else throw new Error('empty');
    } catch {
      ta.current?.focus();
      space.toast(t.text.pasteHint);
    }
  };

  return (
    <section className="card flex flex-col" aria-labelledby="text-title">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-night-line">
        <h2 id="text-title" className="font-semibold text-slate-900 dark:text-white">
          {t.text.title}
        </h2>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost min-h-9 px-2.5" onClick={pasteAndSend}>
            <ClipboardPaste size={16} aria-hidden />
            <span className="hidden sm:inline">{t.text.pasteSend}</span>
            <span className="sr-only sm:hidden">{t.text.pasteSend}</span>
          </button>
          <button type="button" className="btn-ghost min-h-9 px-2.5" onClick={() => space.copyLatest()}>
            <ClipboardCopy size={16} aria-hidden />
            <span className="hidden sm:inline">{t.text.copyLatest}</span>
            <span className="sr-only sm:hidden">{t.text.copyLatest}</span>
          </button>
        </div>
      </header>
      <form
        className="flex flex-col gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          share();
        }}
      >
        <textarea
          ref={ta}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              share();
            }
          }}
          placeholder={t.text.placeholder}
          aria-label={t.text.placeholder}
          maxLength={TEXT_MAX}
          rows={4}
          className="input min-h-28 resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="hidden text-xs text-slate-400 sm:inline">
            <kbd>{isMac() ? '⌘' : 'Ctrl'}</kbd> + <kbd>Enter</kbd>
          </span>
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDraft('')} disabled={!draft}>
              {t.text.clear}
            </button>
            <button type="submit" className="btn-primary" disabled={!draft.trim() || sending}>
              {t.text.share}
              <SendHorizontal size={16} aria-hidden />
            </button>
          </div>
        </div>
      </form>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {texts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t.text.empty}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {texts.map((i) => (
              <TextItem key={i.id} item={i} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
