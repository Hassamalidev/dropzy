import { type DeviceType, cleanDeviceName, detectDeviceType, randomDeviceName, randomToken } from '@dropzy/shared';

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

export function deviceName(): string {
  let n = read('dz-name');
  if (!n || !cleanDeviceName(n)) {
    n = randomDeviceName();
    write('dz-name', n);
  }
  return n;
}

export function setDeviceName(name: string) {
  write('dz-name', name);
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
