// One-off Backblaze B2 bucket setup via the B2 native API (no `b2` CLI / pip needed).
// Sets the CORS rule browsers need for direct uploads and "keep only the last version".
// Usage: node scripts/b2-bucket-setup.mjs [bucketName]
// Asks for your MASTER application key (it can edit bucket settings). Nothing is saved.
import { createInterface } from 'node:readline';

const BUCKET = process.argv[2] || 'dropzy-files-hassam';
const ORIGINS = ['https://www.dropzy.tech', 'https://dropzy.tech', 'http://localhost:4321'];

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : s.replace(/[^\r\n]/g, '*'));
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function b2(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${url.split('/').pop()}: ${data.code} — ${data.message}`);
  return data;
}

const keyId = await ask('Master keyID: ');
const appKey = await ask('Master applicationKey (hidden): ', true);

const authRes = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
  headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${appKey}`).toString('base64')}` },
});
const auth = await authRes.json();
if (!authRes.ok) throw new Error(`authorize: ${auth.code} — ${auth.message}`);
const api = auth.apiInfo.storageApi.apiUrl;
const token = auth.authorizationToken;
const accountId = auth.accountId;

console.log(`\nS3 endpoint for this account: ${auth.apiInfo.storageApi.s3ApiUrl.replace(/^https:\/\//, '')}`);
const { buckets: all } = await b2(`${api}/b2api/v3/b2_list_buckets`, token, { accountId });
console.log(`Buckets in this account: ${all.map((b) => `${b.bucketName} (${b.bucketType})`).join(', ') || 'none'}`);
const bucket = all.find((b) => b.bucketName === BUCKET);
if (!bucket) {
  console.log(`\nNo bucket named "${BUCKET}". Re-run with the right name: node scripts/b2-bucket-setup.mjs <bucketName>`);
  process.exit(1);
}

const updated = await b2(`${api}/b2api/v3/b2_update_bucket`, token, {
  accountId,
  bucketId: bucket.bucketId,
  corsRules: [
    {
      corsRuleName: 'dropzy',
      allowedOrigins: ORIGINS,
      allowedOperations: ['s3_get', 's3_head', 's3_put'],
      allowedHeaders: ['*'],
      exposeHeaders: ['ETag'],
      maxAgeSeconds: 3600,
    },
  ],
  // Keep only the last version: S3 deletes only hide a file in B2; this removes hidden files after 1 day.
  lifecycleRules: [{ fileNamePrefix: '', daysFromHidingToDeleting: 1, daysFromUploadingToHiding: null }],
});

console.log('\nBucket updated:');
console.log(
  JSON.stringify(
    { bucketName: updated.bucketName, bucketType: updated.bucketType, corsRules: updated.corsRules, lifecycleRules: updated.lifecycleRules },
    null,
    2,
  ),
);
