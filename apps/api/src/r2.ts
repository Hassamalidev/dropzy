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

export function makeStore(env: Env, origin: string): Store {
  return R2.configured(env) ? new R2(env) : new BoundStore(env, origin);
}

// S3-compatible store: works with Cloudflare R2 and any S3-compatible backend (e.g. Backblaze B2).
// Set R2_ENDPOINT to use an external provider (e.g. "s3.us-west-004.backblazeb2.com");
// leave it unset to use Cloudflare R2 (https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com).
export class R2 implements Store {
  private client: AwsClient;
  private base: string;

  constructor(env: Env) {
    const endpoint = env.R2_ENDPOINT;
    // Extract region from endpoint hostname (e.g. "s3.us-west-004.backblazeb2.com" → "us-west-004")
    const region = endpoint ? endpoint.split('.')[1] : 'auto';
    this.client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
      service: 's3',
      region,
    });
    this.base = endpoint
      ? `https://${endpoint}/${env.R2_BUCKET}`
      : `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
  }

  static configured(env: Env): boolean {
    const hasKeys = !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
    if (env.R2_ENDPOINT) return hasKeys && !!env.R2_BUCKET;
    return hasKeys && !!env.R2_ACCOUNT_ID && !env.R2_ACCOUNT_ID.startsWith('<');
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
    if (!res.ok || text.includes('<Error>')) throw new Error(`complete multipart failed (${res.status})`);
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    const res = await this.client.fetch(this.url(key, { uploadId }).toString(), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`abort multipart failed (${res.status})`);
  }
}

export class BoundStore implements Store {
  constructor(private env: Env, private origin: string) {}
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
