export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const PROTOCOL_VERSION = 1;

// Lifetimes (§2)
export const WIFI_ITEM_TTL = 2 * HOUR;
export const SES_TTL = 2 * HOUR;
export const SES_EXTEND = 2 * HOUR;
export const SES_MAX = 6 * HOUR;
export const ROOM_TTL = 24 * HOUR;
export const ROOM_EXTEND = 24 * HOUR;
export const ROOM_MAX = 48 * HOUR;
export const PASS_TTL = 2 * HOUR;
export const PAIR_CODE_TTL = 10 * MIN;
export const BUSY_DURATION = 2 * HOUR;
export const BURN_GRACE = HOUR;
export const STALE_UPLOAD = 2 * HOUR;
export const DIRECT_FILE_TTL = 2 * HOUR;

// Limits
export const TEXT_MAX = 50_000;
export const NAME_MAX = 255;
export const DEVICE_NAME_MAX = 24;
export const MAX_ITEMS_PER_SPACE = 200;
export const MAX_ITEMS_PER_DEVICE = 50;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_FOUND = 30;
export const MAX_DIRECT_TARGETS = 4;
export const THUMB_MAX_BYTES = 24 * 1024;
export const TEXT_QR_MAX = 500;
export const SEARCH_THRESHOLD = 5;
export const MAX_PEERS_SHOWN = 6;

// Timing (§8.3, §8.4)
export const PING_VISIBLE = 60_000;
export const PING_HIDDEN = 5 * MIN;
export const PONG_TIMEOUT = 10_000;
export const STALE_SOCKET = 6 * MIN;
export const REQUEST_TIMEOUT = 10_000;
export const RECONNECT_MIN = 500;
export const RECONNECT_MAX = 30_000;
export const CONNECT_CARD_DELAY = 8_000;
export const COUNTDOWN_TICK = 30_000;
export const EXPIRY_WARNING = 10 * MIN;
export const UNDO_MS = 5_000;
export const TOAST_MS = 4_000;

// Uploads (§9.3)
export const MiB = 1024 * 1024;
export const GiB = 1024 * MiB;
export const SINGLE_PUT_MAX = 16 * MiB;
export const URL_BATCH = 10;
export const SIGNED_PUT_TTL = 3600;
export const SIGNED_GET_TTL = 900;

// E2EE (§10)
export const E2EE_CHUNK = MiB;
export const E2EE_TAG = 16;

// Direct transfer (§9.2)
export const DIRECT_FRAME = 64 * 1024;
export const DIRECT_HIGH_WATER = 8 * MiB;
export const DIRECT_LOW_WATER = MiB;
export const DIRECT_CONNECT_TIMEOUT = 8_000;
export const DIRECT_STALL_TIMEOUT = 15_000;
export const DIRECT_IDLE_CLOSE = 2 * MIN;
export const ICE_GATHER_CAP = 2_500;
export const IOS_DIRECT_CAP = GiB;

export const RISKY_EXTENSIONS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'scr',
  'ps1',
  'vbs',
  'js',
  'jar',
  'apk',
  'dmg',
  'pkg',
  'sh',
  'app',
];
