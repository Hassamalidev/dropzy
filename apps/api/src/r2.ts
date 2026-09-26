import { b64url, fromB64url } from '@dropzy/shared';
import { AwsClient } from 'aws4fetch';
import type { Env } from './env';
import { hmac, hmacVerify } from './ip';

/** Where file bytes go: signed URLs the browser PUTs to and GETs from, plus multipart bookkeeping. */
export interface Store {
  presignPut(key: string, headers: Record<string, string>, ttl: number, size: number): Promise<string>;
  presignPart(key: string, uploadId: string, part: number, ttl: number, size: number): Promise<string>;
  presignGet(key: string, ttl: number): Promise<string>;
  createMultipart(key: string, contentType: string, disposition: string): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}

/** S3 keys when configured (bytes go straight to R2); otherwise the Worker relays them through its binding. */
export function makeStore(env: Env, origin: string): Store {
  return R2.configured(env) ? new R2(env) : new BoundStore(env, origin);
}

// Signed URLs and multipart calls against R2's S3 API (§9.3). File bytes never pass through here.
// Path-style URLs: https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}

export class R2 implements Store {
  private client: AwsClient;
  private base: string;

  constructor(env: Env) {
    this.client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
      service: 's3',
      region: 'auto',
    });
    this.base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  }

  static configured(env: Env): boolean {
    return !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID && !env.R2_ACCOUNT_ID.startsWith('<'));
  }

  private url(key: string, params: Record<string, string> = {}): URL {
    const u = new URL(`${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u;
  }

  private async presign(method: string, u: URL, ttl: number, headers: Record<string, string> = {}): Promise<string> {
    u.searchParams.set('X-Amz-Expires', String(ttl));
    const signed = await this.client.sign(new Request(u, { method, headers }), { aws: { signQuery: true } });
    return signed.url;
  }

  /** Single PUT. The client must send exactly `headers` — they are part of the signature. */
  presignPut(key: string, headers: Record<string, string>, ttl: number, _size?: number) {
    return this.presign('PUT', this.url(key), ttl, headers);
  }

  presignPart(key: string, uploadId: string, part: number, ttl: number, _size?: number) {
    return this.presign('PUT', this.url(key, { partNumber: String(part), uploadId }), ttl);
  }

  presignGet(key: string, ttl: number) {
    return this.presign('GET', this.url(key), ttl);
  }

  async createMultipart(key: string, contentType: string, disposition: string): Promise<string> {
    const res = await this.client.fetch(this.url(key, { uploads: '' }).toString().replace('uploads=', 'uploads'), {
      method: 'POST',
      headers: { 'content-type': contentType, 'content-disposition': disposition },
    });
    const xml = await res.text();
    const id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
    if (!res.ok || !id) throw new Error(`create multipart failed (${res.status})`);
    return id;
  }

  async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void> {
    const body = `<CompleteMultipartUpload>${parts
      .map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`)
      .join('')}</CompleteMultipartUpload>`;
    const res = await this.client.fetch(this.url(key, { uploadId }).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body,
    });
    const text = await res.text();
    // S3 can answer 200 with an <Error> body.
    if (!res.ok || text.includes('<Error>')) throw new Error(`complete multipart failed (${res.status})`);
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    const res = await this.client.fetch(this.url(key, { uploadId }).toString(), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`abort multipart failed (${res.status})`);
  }
}

// ───────────────────────── binding relay ─────────────────────────
// Without S3 keys (local dev, or a deploy that skipped the R2 token) the Worker hands out its own
// signed /v1/blob URLs and moves the bytes through the FILES binding. Parts stay ≤ 64 MiB, under the
// Worker request-body limit. Token: base64url(JSON) + "." + base64url(HMAC-SHA256(PASS_SECRET, payload)).

export type BlobGrant =
  | { m: 'put'; k: string; exp: number; max: number; ct: string; cd: string }
  | { m: 'part'; k: string; exp: number; max: number; u: string; n: number }
  | { m: 'get'; k: string; exp: number };

export async function signBlob(secret: string, grant: BlobGrant): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(grant)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifyBlob(secret: string, token: string, now = Date.now()): Promise<BlobGrant | null> {
  if (token.length > 2048) return null;
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  try {
    if (!(await hmacVerify(secret, m[1], fromB64url(m[2])))) return null; // constant-time
    const g = JSON.parse(new TextDecoder().decode(fromB64url(m[1]))) as BlobGrant;
    if (typeof g?.k !== 'string' || !g.k.startsWith('f/') || typeof g.exp !== 'number' || g.exp <= now) return null;
    return g;
  } catch {
    return null;
  }
}

export class BoundStore implements Store {
  constructor(
    private env: Env,
    private origin: string,
  ) {}

  private async url(grant: BlobGrant) {
    return `${this.origin}/v1/blob/${await signBlob(this.env.PASS_SECRET, grant)}`;
  }

  presignPut(key: string, headers: Record<string, string>, ttl: number, size: number) {
    const exp = Date.now() + ttl * 1000;
    return this.url({ m: 'put', k: key, exp, max: size, ct: headers['content-type'], cd: headers['content-disposition'] });
  }

  presignPart(key: string, uploadId: string, part: number, ttl: number, size: number) {
    return this.url({ m: 'part', k: key, exp: Date.now() + ttl * 1000, max: size, u: uploadId, n: part });
  }

  presignGet(key: string, ttl: number) {
    return this.url({ m: 'get', k: key, exp: Date.now() + ttl * 1000 });
  }

  async createMultipart(key: string, contentType: string, disposition: string) {
    const up = await this.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType, contentDisposition: disposition } });
    return up.uploadId;
  }

  async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]) {
    const up = this.env.FILES.resumeMultipartUpload(key, uploadId);
    await up.complete(parts.map((p) => ({ partNumber: p.n, etag: p.etag.replace(/"/g, '') })));
  }

  async abortMultipart(key: string, uploadId: string) {
    try {
      await this.env.FILES.resumeMultipartUpload(key, uploadId).abort();
    } catch {
      // already gone
    }
  }
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
