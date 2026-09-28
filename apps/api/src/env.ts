import type { AdminDO } from './admin/AdminDO';
import type { DirectoryDO } from './directory/DirectoryDO';
import type { GuardDO } from './guard/GuardDO';
import type { SpaceDO } from './space/SpaceDO';

export interface Env {
  SPACE: DurableObjectNamespace<SpaceDO>;
  DIRECTORY: DurableObjectNamespace<DirectoryDO>;
  GUARD: DurableObjectNamespace<GuardDO>;
  ADMIN: DurableObjectNamespace<AdminDO>;
  /** Optional: local dev / relay mode. Production can use any S3-compatible store instead (R2_ENDPOINT). */
  FILES?: R2Bucket;
  RL_CONNECT: RateLimit;
  RL_CREATE: RateLimit;
  RL_JOIN: RateLimit;
  RL_PUBLIC: RateLimit;

  SITE_ORIGIN: string;
  EXTRA_ORIGINS: string;
  STORAGE_ENABLED: string;
  TURN_ENABLED: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  /** S3-compatible endpoint host, e.g. s3.us-west-004.backblazeb2.com. Unset → R2 via R2_ACCOUNT_ID. */
  R2_ENDPOINT?: string;
  /** Signing region. Defaults to the endpoint's second label (us-west-004 above), or 'auto' for R2. */
  S3_REGION?: string;
  MAX_CLOUD_FILE_BYTES: string;
  MAX_STORED_BYTES: string;
  PER_IP_DAILY_UPLOAD_BYTES: string;
  CLASS_A_DAILY_BUDGET: string;
  CLASS_B_DAILY_BUDGET: string;
  BUSY_NETWORK_DEVICES: string;

  // Secrets (§16.5)
  IP_HASH_SECRET: string;
  PASS_SECRET: string;
  ADMIN_TOKEN: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
}

export const flag = (v: string | undefined) => v === 'true' || v === '1';
export const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export function allowedOrigins(env: Env): string[] {
  return [env.SITE_ORIGIN, ...(env.EXTRA_ORIGINS || '').split(',')].map((s) => s.trim()).filter(Boolean);
}

/** S3 keys plus somewhere to send them: an explicit R2_ENDPOINT, or an R2 account id. */
export const s3Configured = (env: Env) =>
  !!(
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET &&
    (env.R2_ENDPOINT || (env.R2_ACCOUNT_ID && !env.R2_ACCOUNT_ID.startsWith('<')))
  );

/**
 * Uploads need the switch on and a store: S3 keys (bytes go straight to the bucket) or the FILES
 * binding (the Worker relays them, see r2.ts). Otherwise direct-only mode (§4.5).
 */
export const storageEnabled = (env: Env) => flag(env.STORAGE_ENABLED) && (s3Configured(env) || !!env.FILES);
export const maxCloudBytes = (env: Env) => num(env.MAX_CLOUD_FILE_BYTES, 2 * 1024 ** 3);
