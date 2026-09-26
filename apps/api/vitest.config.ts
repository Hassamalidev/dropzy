import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          IP_HASH_SECRET: 'test-ip-secret',
          PASS_SECRET: 'test-pass-secret',
          ADMIN_TOKEN: 'test-admin-token',
          STORAGE_ENABLED: 'false',
          SITE_ORIGIN: 'http://localhost:4321',
        },
      },
    }),
  ],
});
