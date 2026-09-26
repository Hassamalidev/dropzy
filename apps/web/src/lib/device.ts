import { ADJECTIVES, ANIMALS, DEVICE_LABEL, DEVICE_NAME_MAX, type DeviceType, cleanDeviceName, detectDeviceType, randomToken } from '@dropzy/shared';

// Device identity kept in localStorage (§7.5, §14.6). Every access is guarded: storage can be blocked.

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

let memId: string | null = null;
export function deviceId(): string {
  let id = read('dz-device') ?? memId;
  if (!id) {
    id = randomToken(16);
    write('dz-device', id);
  }
  memId = id;
  return id;
}

/**
 * The name others here see. A name the person chose wins; otherwise one built from what the
 * browser tells us ("Pixel 8", "iPhone", "Chrome on Windows"). Browsers never expose the
 * device's own name, so that's as close as a web page gets.
 */
export function deviceName(): string {
  return chosenName() ?? baseName();
}

/** Like deviceName, but asks Chrome/Edge for the phone model first (Android only). */
export async function resolveDeviceName(): Promise<string> {
  const chosen = chosenName();
  if (chosen) return chosen;
  const model = await phoneModel();
  return model ? clip(model) : baseName();
}

// Kept in memory too: with storage blocked, a rename would otherwise be undone by the next hello.
let memName: string | null = null;

export function setDeviceName(name: string) {
  memName = name;
  write('dz-name', name);
}

function chosenName(): string | null {
  const n = memName ?? read('dz-name');
  // Older versions stored a random "Blue Fox" here; those weren't chosen, so drop them.
  if (!n || !cleanDeviceName(n) || (n !== memName && isRandomName(n))) return null;
  return n;
}

function isRandomName(n: string): boolean {
  const [adj, animal, ...rest] = n.split(' ');
  return !rest.length && ADJECTIVES.includes(adj) && ANIMALS.some(([a]) => a === animal);
}

function baseName(): string {
  const type = deviceType();
  if (type === 'iphone' || type === 'ipad' || type === 'android') return DEVICE_LABEL[type];
  const os = type === 'windows' ? 'Windows' : type === 'other' ? '' : DEVICE_LABEL[type];
  const b = browser();
  return clip(b && os ? `${b} on ${os}` : os || b || DEVICE_LABEL.other);
}

function browser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return '';
}

async function phoneModel(): Promise<string> {
  try {
    const uad = (navigator as any).userAgentData;
    if (!uad?.mobile || typeof uad.getHighEntropyValues !== 'function') return '';
    const { model } = (await uad.getHighEntropyValues(['model'])) as { model?: string };
    const m = (model ?? '').trim();
    // Samsung reports its model code ("SM-S911B"); say whose it is.
    return /^SM-/i.test(m) ? `Samsung ${m}` : m;
  } catch {
    return '';
  }
}

function clip(s: string): string {
  return s.length > DEVICE_NAME_MAX ? s.slice(0, DEVICE_NAME_MAX).trim() : s;
}

export function deviceType(): DeviceType {
  return detectDeviceType(navigator.userAgent, navigator.maxTouchPoints || 0);
}

export const isIOS = () => {
  const t = deviceType();
  return t === 'iphone' || t === 'ipad';
};

// Wi-Fi delete tokens: {itemId: [token, expiresAt]} until expiry (§7.5).
type Tokens = Record<string, [string, number]>;
function tokens(): Tokens {
  try {
    const all = JSON.parse(read('dz-del') || '{}') as Tokens;
    const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (v[1] < now) delete all[k];
    return all;
  } catch {
    return {};
  }
}
export function saveDeleteToken(id: string, token: string, expiresAt: number) {
  const all = tokens();
  all[id] = [token, expiresAt];
  write('dz-del', JSON.stringify(all));
}
export function deleteToken(id: string): string | undefined {
  return tokens()[id]?.[0];
}

// Session storage helpers (drafts, Wi-Fi pass).
export function session(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function setSession(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}
