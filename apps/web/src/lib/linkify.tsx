import { LinkifyIt } from 'linkify-it';
import type { ReactNode } from 'react';

// Text nodes only; http/https links only (§11).
const linkify = new LinkifyIt({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });

export function Linkified({ text }: { text: string }): ReactNode {
  const matches = linkify.match(text)?.filter((m) => m.schema === 'http:' || m.schema === 'https:') ?? [];
  if (!matches.length) return text;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of matches) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={m.url} target="_blank" rel="noopener noreferrer nofollow ugc" className="link break-all">
        {m.text}
      </a>,
    );
    last = m.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
