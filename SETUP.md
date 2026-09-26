# Setting up Dropzy

Dropzy is two deployments: a static Astro site on **Vercel** (`apps/web`) and a Cloudflare **Worker** with Durable Objects (`apps/api`). Uploaded files live in **Cloudflare R2**. Everything fits the free tiers (see SPEC.md §4).

You need Node 22+ and pnpm 9 (`npm i -g pnpm@9` or `corepack enable`).

```sh
pnpm install
```

---

## 1. Run it locally

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars   # local secrets
cp apps/web/.env.example apps/web/.env             # PUBLIC_API_URL=http://localhost:8787
pnpm dev:api    # wrangler dev on http://localhost:8787
pnpm dev:web    # astro dev on http://localhost:4321
```

Open http://localhost:4321 in two browser windows. Text, rooms, Private Share and **direct transfers** all work locally.
Uploads need real R2 credentials: without `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in `.dev.vars`, the API runs in
**direct-only mode** (same as `STORAGE_ENABLED=false`). To test uploads locally, put your R2 token in `.dev.vars` and add
`http://localhost:4321` to the bucket's CORS rules (step 3).

Checks:

```sh
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @dropzy/web build
```

---

## 2. Cloudflare account and the Worker

1. Create a free account at https://dash.cloudflare.com/sign-up (no card needed for Workers and Durable Objects).
2. Log in from the repo:
   ```sh
   cd apps/api
   npx wrangler login
   ```
3. Edit `apps/api/wrangler.jsonc` → `vars`:
   - `SITE_ORIGIN`: your site, e.g. `https://dropzy.app`
   - `EXTRA_ORIGINS`: comma-separated extra origins (e.g. a Vercel preview URL). Remove `http://localhost:4321` in production if you like.
   - `R2_ACCOUNT_ID`: your account ID (Dashboard → right sidebar "Account ID").
   - `compatibility_date`: the date you create the project.
4. Set secrets (each asks for a value; use 32+ random bytes, e.g. `openssl rand -base64 32`):
   ```sh
   npx wrangler secret put IP_HASH_SECRET
   npx wrangler secret put PASS_SECRET
   npx wrangler secret put ADMIN_TOKEN
   ```
5. Deploy:
   ```sh
   npx wrangler deploy
   ```
   Note the URL, e.g. `https://dropzy-api.<you>.workers.dev`. Check `https://dropzy-api.<you>.workers.dev/v1/health`.

---

## 3. R2 (optional, recommended)

Activating R2 asks for a card or PayPal; usage inside the free tier isn't charged, and the cost guard pauses uploads well before
the limits. **No card?** Set `"STORAGE_ENABLED": "false"` in `wrangler.jsonc` and skip this section — Dropzy runs in
direct-only mode.

1. Dashboard → **R2 Object Storage** → **Create bucket** → name `dropzy-files`.
2. **R2 → Manage API tokens → Create API token**: permission **Object Read & Write**, **Apply to specific buckets only** →
   `dropzy-files`. Copy the Access Key ID and Secret Access Key, then:
   ```sh
   npx wrangler secret put R2_ACCESS_KEY_ID
   npx wrangler secret put R2_SECRET_ACCESS_KEY
   ```
3. Bucket → **Settings → CORS policy → Edit**, paste (use your own origins):
   ```json
   [{
     "AllowedOrigins": ["https://dropzy.app", "http://localhost:4321"],
     "AllowedMethods": ["GET", "PUT", "HEAD"],
     "AllowedHeaders": ["content-type", "content-disposition", "range"],
     "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
     "MaxAgeSeconds": 3600
   }]
   ```
4. Bucket → **Settings → Object lifecycle rules → Add rule**:
   - Rule 1: delete objects **2 days** after upload (prefix: none).
   - Rule 2: abort incomplete multipart uploads after **1 day**.
5. **Billing → Notifications**: add a billing/usage alert so you hear about anything unexpected.
6. Redeploy: `npx wrangler deploy`.

Budgets (in `wrangler.jsonc` `vars`): `MAX_STORED_BYTES` (8 GiB), `CLASS_A_DAILY_BUDGET` (30,000),
`CLASS_B_DAILY_BUDGET` (300,000), `PER_IP_DAILY_UPLOAD_BYTES` (3 GiB), `MAX_CLOUD_FILE_BYTES` (2 GiB).

### Optional: TURN relay

Off by default. To enable: create a TURN key in Cloudflare Realtime, then
`npx wrangler secret put TURN_KEY_ID`, `npx wrangler secret put TURN_API_TOKEN`, set `"TURN_ENABLED": "true"`, and set
`PUBLIC_TURN_ENABLED=true` on Vercel.

---

## 4. Vercel (the site)

Vercel Hobby is free for **non-commercial** use.

1. Push the repo to GitHub, then https://vercel.com/new → **Import** the repo.
2. **Root Directory**: `apps/web`. Framework preset: **Astro**. Build command and output are detected
   (`astro build`, `dist`). Install command: `pnpm install`.
3. **Environment variables**:
   - `PUBLIC_API_URL` = `https://dropzy-api.<you>.workers.dev`
   - `PUBLIC_SITE_URL` = `https://dropzy.app` (your domain)
   - optional `PUBLIC_MAX_UPLOAD_BYTES` if you changed `MAX_CLOUD_FILE_BYTES`
4. Edit `apps/web/vercel.json` → the `Content-Security-Policy` value: replace `<ACCOUNT_ID>` with your Cloudflare account ID
   and `<API_HOST>` with `dropzy-api.<you>.workers.dev`.
5. Deploy, then add your domain under **Settings → Domains**. Update `SITE_ORIGIN` in `wrangler.jsonc` and the R2 CORS rule to
   match, and redeploy the Worker.
6. Update the `Sitemap:` line in `apps/web/public/robots.txt` to your domain.

On a preview deployment, check that `/s/abc` serves the static shell (no Function is invoked) — the shell reads the token from the
address bar.

---

## 5. Admin

Open `https://<your site>/admin` and paste `ADMIN_TOKEN`. It shows today's usage against the budgets, open reports (delete the
item, or block the uploader's IP hash for 24 h / 7 days) and feedback. The token is kept in memory only.

---

## 6. Rotating secrets

- `IP_HASH_SECRET`: rotating just resets which devices count as "the same network".
- `PASS_SECRET`: rotating invalidates existing Connect-a-device passes (they last 2 h anyway).
- `ADMIN_TOKEN`: rotate any time.
