import { AwsClient } from 'aws4fetch';
import type { Env } from './env';

// Signed URLs and multipart calls against R2's S3 API (§9.3). File bytes never pass through here.
// Path-style URLs: https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}

export class R2 {
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
  presignPut(key: string, headers: Record<string, string>, ttl: number) {
    return this.presign('PUT', this.url(key), ttl, headers);
  }

  presignPart(key: string, uploadId: string, part: number, ttl: number) {
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

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
