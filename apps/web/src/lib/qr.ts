// QR codes, loaded on demand (§4.4). Error correction M, a generous white quiet zone even in dark mode.

const cache = new Map<string, string>();

export async function qrDataUrl(text: string): Promise<string> {
  const hit = cache.get(text);
  if (hit) return hit;
  const QR = await import('qrcode');
  const svg = await QR.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    color: { dark: '#2a1a04', light: '#ffffff' },
  });
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(text, url);
  return url;
}
