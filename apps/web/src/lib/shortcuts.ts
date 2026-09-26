// Ctrl/⌘+V outside inputs: pasted files are shared, pasted text goes into the textarea (§11).
// We listen to the paste event itself (never bind Ctrl+Shift+V).

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

export function initPasteShortcut(): () => void {
  const onPaste = (e: ClipboardEvent) => {
    if (isEditable(e.target) || !e.clipboardData) return;
    const files = Array.from(e.clipboardData.files || []);
    if (files.length) {
      e.preventDefault();
      dispatchEvent(new CustomEvent('dz:files', { detail: files }));
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text) {
      e.preventDefault();
      dispatchEvent(new CustomEvent('dz:paste-text', { detail: text }));
    }
  };
  document.addEventListener('paste', onPaste);
  return () => document.removeEventListener('paste', onPaste);
}
