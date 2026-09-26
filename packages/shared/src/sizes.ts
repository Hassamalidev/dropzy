import { E2EE_CHUNK, E2EE_TAG, GiB, MiB, SINGLE_PUT_MAX } from './constants';

/** Part size for multipart uploads (§9.3). Encrypted uploads use a multiple of the encrypted chunk. */
export function partSizeFor(stored: number, e2ee: boolean): number {
  const base = stored <= GiB ? 16 * MiB : stored <= 4 * GiB ? 32 * MiB : 64 * MiB;
  if (!e2ee) return base;
  return (base / MiB) * (E2EE_CHUNK + E2EE_TAG);
}

export function isSinglePut(stored: number): boolean {
  return stored <= SINGLE_PUT_MAX;
}

export function partCount(stored: number, partSize: number): number {
  return Math.max(1, Math.ceil(stored / partSize));
}

/** Number of encrypted chunks for a plaintext size (a 0-byte file is one empty chunk). */
export function e2eeChunks(plainSize: number): number {
  return Math.max(1, Math.ceil(plainSize / E2EE_CHUNK));
}

export function storedSize(plainSize: number, e2ee: boolean): number {
  return e2ee ? plainSize + E2EE_TAG * e2eeChunks(plainSize) : plainSize;
}

/** Estimated R2 Class A operations for an upload (§14.4). */
export function estClassA(stored: number, e2ee: boolean): number {
  if (isSinglePut(stored)) return 1;
  return partCount(stored, partSizeFor(stored, e2ee)) + 2;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
