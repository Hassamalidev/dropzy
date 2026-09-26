# Dropzy

Free, friendly file & text sharing between any devices, in the browser. No app, no account — and everything deletes itself.

- **Wi-Fi Share** (`/`) — devices on the same network find each other.
- **Private Share** (`/private`) — an end-to-end encrypted link between two devices.
- **Room** (`/room/new`) — a 6-digit code for groups.

Files go directly browser-to-browser when the other device is online, and are uploaded for a few hours otherwise.

| Path | What |
|---|---|
| `apps/web` | Astro static site + React share island (Vercel) |
| `apps/api` | Cloudflare Worker (Hono) + Durable Objects + R2 signing |
| `packages/shared` | Protocol types, constants, helpers |

See [SPEC.md](SPEC.md) for the full spec and [SETUP.md](SETUP.md) to run and deploy it.

```sh
pnpm install
pnpm dev:api   # http://localhost:8787
pnpm dev:web   # http://localhost:4321
pnpm lint && pnpm typecheck && pnpm test
```
