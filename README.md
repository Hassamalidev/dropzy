# Dropzy

**Free, friendly file and text sharing between any devices, in the browser.** No app, no account, and everything deletes itself.

Live at **[www.dropzy.tech](https://www.dropzy.tech)**

Open the page on two devices and start sharing. When the other device is online, files travel directly from one browser to the other and are never uploaded. Otherwise they are uploaded for a few hours and then deleted automatically.

## Ways to share

| | Wi-Fi Share | Private Share | Room |
|---|---|---|---|
| Where | `/` | `/private` | `/room/new` |
| Who's in | Everyone on the same network, automatically | Anyone with the link or QR code | Anyone with the 6-digit code, link or QR code |
| Best for | Your own devices at home or work | You and one other person, or your devices on different networks | Groups |
| Lifetime | 2 hours per item | 2 hours, extendable to 6 | 24 hours, extendable to 48 |
| Files go | Directly if exactly one other device is here, otherwise uploaded | Directly if exactly one other device is here, otherwise uploaded | Always uploaded, so latecomers get them |
| Encryption | In transit | End-to-end (the key lives in the link and never reaches the server) | In transit |

## Features

- **Text and files**: drag and drop, file picker or paste. Download everything as one zip.
- **Realtime**: items and devices appear instantly, with friendly device names and join/leave notices.
- **Direct transfer**: browser-to-browser over WebRTC, with automatic fallback to upload.
- **QR codes and short codes**: connect a phone by scanning, or type a 6-digit room code.
- **Single-file links** that carry their own decryption key.
- **Private by default**: no cookies, no accounts, raw IP addresses are never stored.
- **Free to run**: everything fits free tiers, and a cost guard pauses uploads before any limit is reached.
- **Dark mode**, a mobile-first layout, keyboard and screen reader support.

## How it's built

```
Browser ──HTTPS / WebSocket──▶ Cloudflare Worker (Hono)
   │                               ├─ SpaceDO      one share or room: items, devices, realtime
   │                               ├─ DirectoryDO  which devices are on the same network
   │                               ├─ GuardDO      storage budgets and per-user daily limits
   │                               └─ AdminDO      reports and feedback
   ├──WebRTC──▶ the other browser (direct transfer)
   └──signed URLs──▶ S3-compatible storage (Cloudflare R2 or Backblaze B2)
```

| Path | What |
|---|---|
| [apps/web](apps/web) | Astro static site with a React share island, Tailwind CSS. Deployed to Vercel. |
| [apps/api](apps/api) | Cloudflare Worker (Hono) with SQLite-backed Durable Objects and signed upload URLs. |
| [packages/shared](packages/shared) | Protocol types, constants and helpers used by both. |
| [docs](docs) | QA checklist and reference notes. |

## Getting started

You need Node 20 or newer (22 recommended) and pnpm 9 (`corepack enable`).

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
cp apps/web/.env.example apps/web/.env
pnpm dev:api   # http://localhost:8787
pnpm dev:web   # http://localhost:4321
```

Open http://localhost:4321 in two browser windows. Text, rooms, Private Share, uploads and direct transfers all work locally, with no cloud account needed.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev:web` / `pnpm dev:api` | Run the site or the Worker locally |
| `pnpm build` | Build every package |
| `pnpm lint` | Lint with Biome |
| `pnpm format` | Format with Biome |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm --filter @dropzy/web e2e` | Run browser tests (Playwright) |
| `node apps/api/scripts/e2e-storage.mjs <api> <origin>` | Check upload, download and delete against a running API |

## Deploying

Dropzy is two deployments:

- **Site**: Vercel, root directory `apps/web`. Set `PUBLIC_API_URL` and `PUBLIC_SITE_URL`.
- **API**: `npx wrangler deploy` from `apps/api`. Settings live in [wrangler.jsonc](apps/api/wrangler.jsonc); keys go in as secrets with `npx wrangler secret put`.

File storage is optional. Any S3-compatible bucket works: Cloudflare R2, or Backblaze B2 by setting `R2_ENDPOINT` (no card required; [b2-bucket-setup.mjs](apps/api/scripts/b2-bucket-setup.mjs) sets the bucket's CORS rules). With `STORAGE_ENABLED` set to `false`, Dropzy runs in direct-only mode.

[SETUP.md](SETUP.md) has the full step-by-step guide, including secrets, CORS, lifecycle rules, budgets and the admin page.

## Documentation

- [SPEC.md](SPEC.md): the full product and technical spec
- [SETUP.md](SETUP.md): running locally and deploying
- [docs/QA.md](docs/QA.md): manual test checklist
