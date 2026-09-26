import { THUMB_MAX_BYTES } from '@dropzy/shared';

// Sender-side thumbnails (§9.6): 256 px long edge, WebP (JPEG fallback), ~0.6 quality, ≤ 24 KB.
// Undecodable files (e.g. HEIC outside Safari) just get a type icon.

const EDGE = 256;

// Decoding a full-size photo takes ~200 MB; dropping 20 at once must not decode them all together.
const MAX_AT_ONCE = 2;
let running = 0;
const queue: (() => void)[] = [];

export async function makeThumb(file: File): Promise<string | undefined> {
  // A finishing thumb hands its slot straight to the next waiter, so a new call can't slip in between.
  if (running >= MAX_AT_ONCE) await new Promise<void>((r) => queue.push(r));
  else running++;
  try {
    return await thumbOf(file);
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}

async function thumbOf(file: File): Promise<string | undefined> {
  try {
    if (file.type.startsWith('image/')) {
      const bmp = await createImageBitmap(file);
      try {
        return await encode(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    }
    if (file.type.startsWith('video/')) return await videoFrame(file);
  } catch {
    // no thumbnail
  }
  return undefined;
}

async function encode(src: CanvasImageSource, w: number, h: number): Promise<string | undefined> {
  let edge = EDGE;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, edge / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(src, 0, 0, cw, ch);
    const quality = 0.6 - attempt * 0.1;
    let url = canvas.toDataURL('image/webp', quality);
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
    const bytes = Math.ceil(((url.length - url.indexOf(',') - 1) * 3) / 4);
    if (bytes <= THUMB_MAX_BYTES) return url;
    edge = Math.round(edge * 0.75); // retry smaller
  }
  return undefined;
}

function videoFrame(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (r: string | undefined) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => done(undefined), 3000);
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.onloadeddata = () => {
      v.currentTime = Math.min(0.1, v.duration || 0.1);
    };
    v.onseeked = async () => done(await encode(v, v.videoWidth, v.videoHeight).catch(() => undefined));
    v.onerror = () => done(undefined);
    v.src = url;
  });
}
