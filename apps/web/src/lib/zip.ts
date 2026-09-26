// "Download all" builds a ZIP in the browser with client-zip (no compression), loaded on demand (§9.8).

export type ZipEntry = { name: string; size?: number; lastModified?: Date; input: () => Promise<Response | Blob | ReadableStream<Uint8Array>> };

export async function zipStream(entries: ZipEntry[]): Promise<ReadableStream<Uint8Array>> {
  const { downloadZip } = await import('client-zip');
  const used = new Set<string>();
  async function* files() {
    for (const e of entries) {
      yield { name: uniqueName(e.name, used), lastModified: e.lastModified, size: e.size, input: await e.input() };
    }
  }
  const res = downloadZip(files());
  if (!res.body) throw new Error('zip');
  return res.body;
}

function uniqueName(name: string, used: Set<string>): string {
  let n = name;
  let i = 1;
  while (used.has(n.toLowerCase())) {
    const dot = name.lastIndexOf('.');
    n = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
    i++;
  }
  used.add(n.toLowerCase());
  return n;
}
