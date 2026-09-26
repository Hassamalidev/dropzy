import { defineConfig, devices } from '@playwright/test';

// End-to-end: two browser contexts per mode against `wrangler dev` + `astro dev` (§17 phase 10).
// Uploads need real R2 credentials, so the API runs in direct-only mode here; the Worker's own
// test suite covers the upload flow.

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4321', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @dropzy/api exec wrangler dev --port 8787 --var STORAGE_ENABLED:false',
      url: 'http://localhost:8787/v1/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @dropzy/web exec astro dev --port 4321',
      url: 'http://localhost:4321',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
