import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { S3Store, makeStore } from '../src/r2';

// A non-R2 provider (Backblaze B2): no FILES binding, so head/delete/list go over the S3 API.
const b2 = {
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_ENDPOINT: 's3.us-west-004.backblazeb2.com',
  R2_BUCKET: 'dropzy-files',
  STORAGE_ENABLED: 'true',
  PASS_SECRET: 'x',
} as unknown as Env;

function mockFetch(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    calls.push(req.clone());
    return handler(req);
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('S3Store without an R2 binding', () => {
  it('is picked by makeStore and signs for the endpoint region', async () => {
    const store = makeStore(b2, '');
    expect(store).toBeInstanceOf(S3Store);
    const url = new URL(await store.presignGet('f/abc', 60));
    expect(url.origin).toBe('https://s3.us-west-004.backblazeb2.com');
    expect(url.pathname).toBe('/dropzy-files/f/abc');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/us-west-004/s3/aws4_request');
  });

  it('reads the stored size with HEAD, null when missing', async () => {
    const calls = mockFetch((req) =>
      req.url.endsWith('/f/there') ? new Response(null, { headers: { 'content-length': '1234' } }) : new Response(null, { status: 404 }),
    );
    const store = new S3Store(b2);
    expect(await store.head('f/there')).toBe(1234);
    expect(await store.head('f/missing')).toBeNull();
    expect(calls[0].method).toBe('HEAD');
  });

  it('deletes with DeleteObjects and a Content-MD5', async () => {
    const calls = mockFetch(() => new Response('<DeleteResult/>'));
    await new S3Store(b2).delete(['f/a', 'f/b&c']);
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.method).toBe('POST');
    expect(new URL(req.url).searchParams.has('delete')).toBe(true);
    const body = await req.text();
    expect(body).toContain('<Key>f/a</Key>');
    expect(body).toContain('<Key>f/b&amp;c</Key>');
    const md5 = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('MD5', new TextEncoder().encode(body)))));
    expect(req.headers.get('content-md5')).toBe(md5);
  });

  it('throws when DeleteObjects answers with an error', async () => {
    mockFetch(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }));
    await expect(new S3Store(b2).delete(['f/a'])).rejects.toThrow();
  });

  it('sums sizes across ListObjectsV2 pages', async () => {
    const calls = mockFetch((req) => {
      const token = new URL(req.url).searchParams.get('continuation-token');
      return new Response(
        token
          ? '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Size>5</Size></Contents></ListBucketResult>'
          : '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>n&amp;2</NextContinuationToken><Contents><Size>10</Size></Contents><Contents><Size>20</Size></Contents></ListBucketResult>',
      );
    });
    expect(await new S3Store(b2).totalSize('f/')).toBe(35);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get('prefix')).toBe('f/');
    expect(new URL(calls[1].url).searchParams.get('continuation-token')).toBe('n&2');
  });
});
