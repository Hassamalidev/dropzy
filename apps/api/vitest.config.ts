import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        // Production uses an S3-compatible bucket; tests seed objects through a local R2 binding.
        r2Buckets: ['FILES'],
        bindings: {
          IP_HASH_SECRET: 'test-ip-secret',
          PASS_SECRET: 'test-pass-secret',
          ADMIN_TOKEN: 'test-admin-token',
          STORAGE_ENABLED: 'true',
          R2_ACCOUNT_ID: 'testaccount',
          R2_ACCESS_KEY_ID: 'test-key-id',
          R2_SECRET_ACCESS_KEY: 'test-secret',
          MAX_CLOUD_FILE_BYTES: '104857600',
          SITE_ORIGIN: 'http://localhost:4321',
        },
      },
    }),
  ],
});
