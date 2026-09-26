import { randomInt } from './codes';
import { DEVICE_NAME_MAX } from './constants';
import { stripUnsafe } from './mime';
import type { DeviceType } from './protocol';

// Curated, non-offensive lists (64 × 64). Every animal has a matching emoji.
export const ADJECTIVES = [
  'Blue', 'Red', 'Green', 'Gold', 'Silver', 'Amber', 'Coral', 'Jade',
  'Ivory', 'Ruby', 'Teal', 'Olive', 'Plum', 'Mint', 'Sky', 'Sunny',
  'Brave', 'Calm', 'Clever', 'Cozy', 'Daring', 'Eager', 'Fancy', 'Gentle',
  'Happy', 'Jolly', 'Kind', 'Lively', 'Lucky', 'Merry', 'Nimble', 'Noble',
  'Polite', 'Proud', 'Quick', 'Quiet', 'Rapid', 'Shiny', 'Smart', 'Snappy',
  'Speedy', 'Steady', 'Swift', 'Tidy', 'Witty', 'Zesty', 'Bright', 'Bold',
  'Cheerful', 'Cosmic', 'Crisp', 'Dreamy', 'Fluffy', 'Frosty', 'Gleeful', 'Humble',
  'Misty', 'Mellow', 'Peppy', 'Plucky', 'Rosy', 'Sleek', 'Sparkly', 'Breezy',
];

export const ANIMALS: [string, string][] = [
  ['Fox', '🦊'], ['Cat', '🐱'], ['Dog', '🐶'], ['Panda', '🐼'], ['Koala', '🐨'], ['Tiger', '🐯'], ['Lion', '🦁'], ['Bear', '🐻'],
  ['Rabbit', '🐰'], ['Mouse', '🐭'], ['Hamster', '🐹'], ['Frog', '🐸'], ['Monkey', '🐵'], ['Owl', '🦉'], ['Penguin', '🐧'], ['Chick', '🐤'],
  ['Duck', '🦆'], ['Eagle', '🦅'], ['Parrot', '🦜'], ['Swan', '🦢'], ['Flamingo', '🦩'], ['Peacock', '🦚'], ['Dove', '🕊️'], ['Turtle', '🐢'],
  ['Lizard', '🦎'], ['Dolphin', '🐬'], ['Whale', '🐳'], ['Seal', '🦭'], ['Otter', '🦦'], ['Beaver', '🦫'], ['Hedgehog', '🦔'], ['Squirrel', '🐿️'],
  ['Octopus', '🐙'], ['Crab', '🦀'], ['Shrimp', '🦐'], ['Fish', '🐟'], ['Shark', '🦈'], ['Bee', '🐝'], ['Butterfly', '🦋'], ['Ladybug', '🐞'],
  ['Snail', '🐌'], ['Horse', '🐴'], ['Unicorn', '🦄'], ['Zebra', '🦓'], ['Giraffe', '🦒'], ['Elephant', '🐘'], ['Rhino', '🦏'], ['Hippo', '🦛'],
  ['Camel', '🐫'], ['Llama', '🦙'], ['Kangaroo', '🦘'], ['Sloth', '🦥'], ['Raccoon', '🦝'], ['Badger', '🦡'], ['Deer', '🦌'], ['Bison', '🦬'],
  ['Cow', '🐮'], ['Pig', '🐷'], ['Sheep', '🐑'], ['Goat', '🐐'], ['Rooster', '🐓'], ['Turkey', '🦃'], ['Dodo', '🦤'], ['Wolf', '🐺'],
];

export function randomDeviceName(): string {
  return `${ADJECTIVES[randomInt(ADJECTIVES.length)]} ${ANIMALS[randomInt(ANIMALS.length)][0]}`;
}

/** Emoji for a name like "Blue Fox"; custom names get a generic device emoji. */
export function emojiFor(name: string): string {
  const last = name.trim().split(/\s+/).pop()?.toLowerCase();
  const hit = ANIMALS.find(([a]) => a.toLowerCase() === last);
  return hit ? hit[1] : '💻';
}

export const DEVICE_LABEL: Record<DeviceType, string> = {
  iphone: 'iPhone',
  ipad: 'iPad',
  android: 'Android',
  windows: 'Windows PC',
  mac: 'Mac',
  linux: 'Linux',
  chromeos: 'Chromebook',
  other: 'Device',
};

export const DEVICE_TYPES = Object.keys(DEVICE_LABEL) as DeviceType[];

export function detectDeviceType(ua: string, maxTouchPoints = 0): DeviceType {
  if (/iPhone|iPod/.test(ua)) return 'iphone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return 'ipad';
  if (/Android/.test(ua)) return 'android';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

/** 1–24 characters after cleanup, or null. */
export function cleanDeviceName(name: string): string | null {
  const s = stripUnsafe(name).replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= DEVICE_NAME_MAX ? s : null;
}
