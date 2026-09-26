// Clipboard with a fallback for older Safari / insecure contexts (§11).

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.fontSize = '16px'; // no zoom on iOS
  const focused = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  const sel = document.getSelection();
  const prev = sel?.rangeCount ? sel.getRangeAt(0) : null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {}
  ta.remove();
  focused?.focus?.({ preventScroll: true }); // give focus back (e.g. to the dialog) without jumping the page
  if (prev && sel) {
    sel.removeAllRanges();
    sel.addRange(prev);
  }
  return ok;
}
