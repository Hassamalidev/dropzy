import { FAVICON, FAVICON_SVG } from './site';

// Tab badge for background tabs: "(2) Dropzy" and a dot on the favicon, cleared on focus (§6.3).

let count = 0;
let baseTitle = '';

const DOT = FAVICON_SVG.replace('</svg>', "<circle cx='26' cy='6' r='6' fill='%23EF4444'/></svg>");

function icon(): HTMLLinkElement | null {
  return document.querySelector('link[rel="icon"]');
}

function render() {
  if (!baseTitle) baseTitle = document.title.replace(/^\(\d+\)\s*/, '');
  document.title = count ? `(${count}) ${baseTitle}` : baseTitle;
  const link = icon();
  if (link) link.href = count ? `data:image/svg+xml,${DOT}` : FAVICON;
}

export function bump() {
  if (!document.hidden) return;
  count++;
  render();
}

export function initBadge() {
  const clear = () => {
    if (!document.hidden && count) {
      count = 0;
      render();
    }
  };
  document.addEventListener('visibilitychange', clear);
  addEventListener('focus', clear);
}
