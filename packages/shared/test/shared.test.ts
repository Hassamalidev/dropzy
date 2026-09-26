import { describe, expect, it } from 'vitest';
import {
  ADJECTIVES,
  ANIMALS,
  E2EE_CHUNK,
  MiB,
  b64url,
  cleanDeviceName,
  cleanName,
  contentDisposition,
  detectDeviceType,
  emojiFor,
  estClassA,
  fromB64url,
  isRisky,
  isSearchCode,
  partSizeFor,
  randomDigits,
  randomId,
  randomSearchCode,
  randomToken,
  safeContentType,
  storedSize,
} from '../src';

describe('codes', () => {
  it('makes tokens and ids of the right length', () => {
    expect(randomToken()).toHaveLength(43);
    expect(randomId()).toHaveLength(22);
    expect(randomDigits()).toMatch(/^\d{6}$/);
    for (let i = 0; i < 50; i++) expect(isSearchCode(randomSearchCode())).toBe(true);
  });
  it('round-trips base64url', () => {
    const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(fromB64url(b64url(b))).toEqual(b);
  });
});

describe('names', () => {
  it('has 64 × 64 names', () => {
    expect(ADJECTIVES).toHaveLength(64);
    expect(ANIMALS).toHaveLength(64);
    expect(new Set(ADJECTIVES).size).toBe(64);
  });
  it('maps emojis', () => {
    expect(emojiFor('Blue Fox')).toBe('🦊');
    expect(emojiFor('My laptop')).toBe('💻');
  });
  it('detects device types', () => {
    expect(detectDeviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iphone');
    expect(detectDeviceType('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ipad');
    expect(detectDeviceType('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('android');
    expect(detectDeviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
  });
  it('validates device names', () => {
    expect(cleanDeviceName('  ')).toBeNull();
    expect(cleanDeviceName('x'.repeat(25))).toBeNull();
    expect(cleanDeviceName('Kitchen‮ PC')).toBe('Kitchen PC');
  });
});

describe('mime & names', () => {
  it('forces dangerous types to octet-stream', () => {
    expect(safeContentType('text/html')).toBe('application/octet-stream');
    expect(safeContentType('image/svg+xml')).toBe('application/octet-stream');
    expect(safeContentType('image/png')).toBe('image/png');
  });
  it('cleans file names', () => {
    expect(cleanName('a‮b/c.txt')).toBe('ab_c.txt');
    const long = cleanName(`${'x'.repeat(300)}.jpeg`);
    expect(long).toHaveLength(255);
    expect(long.endsWith('.jpeg')).toBe(true);
  });
  it('flags risky files', () => {
    expect(isRisky('setup.EXE')).toBe(true);
    expect(isRisky('photo.jpg')).toBe(false);
  });
  it('encodes content-disposition', () => {
    expect(contentDisposition("it's.txt")).toBe("attachment; filename*=UTF-8''it%27s.txt");
  });
});

describe('sizes', () => {
  it('picks part sizes', () => {
    expect(partSizeFor(100 * MiB, false)).toBe(16 * MiB);
    expect(partSizeFor(2048 * MiB, false)).toBe(32 * MiB);
    expect(partSizeFor(5000 * MiB, false)).toBe(64 * MiB);
    expect(partSizeFor(100 * MiB, true) % (E2EE_CHUNK + 16)).toBe(0);
  });
  it('computes encrypted sizes', () => {
    expect(storedSize(0, true)).toBe(16);
    expect(storedSize(MiB, true)).toBe(MiB + 16);
    expect(storedSize(MiB + 1, true)).toBe(MiB + 1 + 32);
  });
  it('estimates class A ops', () => {
    expect(estClassA(MiB, false)).toBe(1);
    expect(estClassA(100 * MiB, false)).toBe(7 + 2);
  });
});
