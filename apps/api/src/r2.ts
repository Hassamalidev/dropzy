import { b64url, fromB64url } from '@dropzy/shared';
import { AwsClient } from 'aws4fetch';
import { type Env, s3Configured } from './env';
import { hmac, hmacVerify } from './ip';

/** Where file bytes go: signed URLs the browser PUTs to and GETs from, plus multipart bookkeeping. */
export interface Store {
  presignPut(key: string, headers: Record<string, string>, ttl: number, size: number): Promise<string>;
  presignPart(key: string, uploadId: string, part: number, ttl: number, size: number): Promise<string>;
  presignGet(key: string, ttl: number): Promise<string>;
  createMultipart(key: string, contentType: string, disposition: string): Promise<string>;
  completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
  /** Stored size in bytes, or null when the object is missing. */
  head(key: string): Promise<number | null>;
  delete(keys: string[]): Promise<void>;
  /** Total bytes stored under `prefix`. */
  totalSize(prefix: string): Promise<number>;
}

/** S3 keys when configured (bytes go straight to the bucket); otherwise the Worker relays them through its binding. */
export function makeStore(env: Env, origin: string): Store {
  return s3Configured(env) ? new S3Store(env) : new BoundStore(env, origin);
}

// Signed URLs and multipart calls against any S3-compatible API — R2, Backblaze B2, … (§9.3).
// File bytes never pass through here. Path-style URLs: {endpoint}/{bucket}/{key}, where the endpoint is
// R2_ENDPOINT (e.g. s3.us-west-004.backblazeb2.com) or, when unset, {R2_ACCOUNT_ID}.r2.cloudflarestorage.com.

export class S3Store implements Store {
  private client: AwsClient;
  private base: string;
  /** With R2 the FILES binding is cheaper for head/delete/list; other providers go over S3. */
  private bound: BoundStore | null;

  constructor(env: Env) {
    this.bound = env.FILES ? new BoundStore(env, '') : null;
    const host = (env.R2_ENDPOINT || `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/^https?:\/\//, '').replace(/\/+$/, '');
    this.client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
      service: 's3',
      region: env.S3_REGION || (env.R2_ENDPOINT ? host.split('.')[1] : 'auto'),
    });
    this.base = `https://${host}/${env.R2_BUCKET}`;
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

  async head(key: string): Promise<number | null> {
    if (this.bound) return this.bound.head(key);
    const res = await this.client.fetch(this.url(key).toString(), { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`head failed (${res.status})`);
    return Number(res.headers.get('content-length'));
  }

  /** DeleteObjects, 1000 keys per call. Content-MD5 is required by the S3 API for this call. */
  async delete(keys: string[]): Promise<void> {
    if (this.bound) return this.bound.delete(keys);
    for (let i = 0; i < keys.length; i += 1000) {
      const body = `<Delete><Quiet>true</Quiet>${keys
        .slice(i, i + 1000)
        .map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
        .join('')}</Delete>`;
      const md5 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('MD5', new TextEncoder().encode(body)))));
      const res = await this.client.fetch(`${this.base}?delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/xml', 'content-md5': md5 },
        body,
      });
      const text = await res.text();
      if (!res.ok || text.includes('<Error>')) throw new Error(`delete failed (${res.status})`);
    }
  }

  async totalSize(prefix: string): Promise<number> {
    if (this.bound) return this.bound.totalSize(prefix);
    let total = 0;
    let token: string | undefined;
    do {
      const u = new URL(this.base);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      u.searchParams.set('max-keys', '1000');
      if (token) u.searchParams.set('continuation-token', token);
      const res = await this.client.fetch(u.toString());
      const xml = await res.text();
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) total += Number(m[1]);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
      if (token) token = xmlUnescape(token);
    } while (token);
    return total;
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

  private get files(): R2Bucket {
    if (!this.env.FILES) throw new Error('no FILES binding');
    return this.env.FILES;
  }

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
    const up = await this.files.createMultipartUpload(key, { httpMetadata: { contentType, contentDisposition: disposition } });
    return up.uploadId;
  }

  async completeMultipart(key: string, uploadId: string, parts: { n: number; etag: string }[]) {
    const up = this.files.resumeMultipartUpload(key, uploadId);
    await up.complete(parts.map((p) => ({ partNumber: p.n, etag: p.etag.replace(/"/g, '') })));
  }

  async abortMultipart(key: string, uploadId: string) {
    try {
      await this.files.resumeMultipartUpload(key, uploadId).abort();
    } catch {
      // already gone
    }
  }

  async head(key: string) {
    return (await this.files.head(key))?.size ?? null;
  }

  async delete(keys: string[]) {
    if (keys.length) await this.files.delete(keys);
  }

  async totalSize(prefix: string) {
    let total = 0;
    let cursor: string | undefined;
    do {
      const page = await this.files.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) total += o.size;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return total;
  }
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function xmlUnescape(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
