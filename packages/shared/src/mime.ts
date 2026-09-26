import { NAME_MAX, RISKY_EXTENSIONS } from './constants';

// Content types we are willing to store as-is. Everything else becomes octet-stream (§9.3).
const SAFE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/3gpp',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/flac',
  'application/pdf',
  'application/zip',
  'application/x-7z-compressed',
  'application/gzip',
  'application/x-tar',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function safeContentType(mime: string | undefined): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  return SAFE.has(m) ? m : 'application/octet-stream';
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

export function isRisky(name: string): boolean {
  return RISKY_EXTENSIONS.includes(extOf(name));
}

export const isImage = (mime?: string) => !!mime && mime.startsWith('image/');
export const isVideo = (mime?: string) => !!mime && mime.startsWith('video/');

// Control and bidi characters (§14.2).
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const BAD_CHARS = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g;

export function stripUnsafe(s: string): string {
  return s.replace(BAD_CHARS, '');
}

export function cleanName(name: string, max = NAME_MAX): string {
  let s = stripUnsafe(name).replace(/[\\/]/g, '_').trim();
  if (!s) s = 'file';
  if (s.length > max) {
    const ext = extOf(s);
    s = ext && ext.length < 16 ? `${s.slice(0, max - ext.length - 1)}.${ext}` : s.slice(0, max);
  }
  return s;
}

/** Keep newlines and tabs in shared text, drop other control and bidi characters. */
export function cleanText(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '');
}

export function contentDisposition(name: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
