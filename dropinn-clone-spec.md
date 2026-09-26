# Build Spec: Browser-Based File & Text Sharing App (dropinn-style clone + extras)

> **How to use this file with Claude Code:** put it in the project root as `SPEC.md` (or paste it into `CLAUDE.md`) and tell Claude Code: *"Read SPEC.md and build the project phase by phase. Stop after each phase so I can test."*
>
> Reference site analyzed: `https://www.dropinn.tech` (September 2026). Use your own brand name, logo, copy and colors — do **not** copy their name, logo, team page or text verbatim. Placeholder brand in this spec: **"Dropzy"** (rename freely).

---

## 1. Product summary

A free, no-account, no-install web app for moving **files (up to 10 GB each)** and **text/links** between any devices (phone ↔ PC, iPhone ↔ Windows, Android ↔ Mac) directly in the browser. Everything is **temporary and auto-deleted** on expiry.

Three sharing modes (plus our new additions in §9):

| Mode | Route | Who can access | How devices connect | Lifetime |
|---|---|---|---|---|
| **Wi-Fi Share** (home) | `/` | Everyone behind the same public IP (same Wi-Fi) | Automatic — zero setup | Each item expires **2 h after it's added** |
| **Private Share** | `/private` → redirects to `/s/{token}` | Anyone with the link / QR | Unguessable link + QR code | Session **2 h** (displayed as "Expires in 2–6h", i.e. extendable) |
| **Room** | `/room/new` → redirects to `/r/{token}` ; `/room/join` | Anyone with the 6-digit code | 6-digit code, QR code, join link | **24 h** (displayed as "Expires in 24–48h", up to 48 h) |

Principles: no sign-up, no tracking cookies, HTTPS everywhere, uploads/downloads go **directly to object storage** via presigned URLs (the app server never proxies file bytes).

---

## 2. Tech stack (matches what the reference uses, observed)

The reference runs **Next.js (App Router, Turbopack build) on Vercel**, with a JSON API under `/api/*` returning `{ ok: boolean, data?: ..., error?: string }`, and the client **polls** (~every 3–5 s) for updates.

Recommended stack:

- **Framework:** Next.js 15+ (App Router), TypeScript, React Server Components where useful.
- **Styling:** Tailwind CSS v4 + CSS variables for light/dark theme. Icons: `lucide-react`.
- **Database:** PostgreSQL (Neon / Supabase) with **Drizzle ORM**, *or* Redis (Upstash) for ephemeral metadata. Recommended: Postgres for metadata + Upstash Redis for rate-limiting.
- **File storage:** S3-compatible object storage — **Cloudflare R2** (no egress fees, best for large files) or AWS S3. Use **multipart uploads** for large files (required for 10 GB).
- **Realtime:** Start with polling (like the reference). Upgrade path: Server-Sent Events or a hosted pub/sub (Pusher / Ably / Supabase Realtime) — see §9.
- **QR codes:** `qrcode` (server) or `qrcode.react` (client).
- **Validation:** `zod` on every API input.
- **Rate limiting:** `@upstash/ratelimit`.
- **Cleanup:** Vercel Cron (or any cron) hitting `/api/cron/cleanup` every 5–10 min + R2/S3 **lifecycle rule** deleting objects older than 49 h as a safety net.
- **Email (contact / feature request):** Resend or similar; or just store in DB.
- **Analytics (optional):** cookieless (Plausible / Umami / Vercel Analytics). No tracking cookies.

---

## 3. Site map & pages

### Global layout (every page)
1. **Top announcement bar** (thin, muted): left — small stacked avatars + "Meet the makers →" linking to `/about`, then text "Built in the open. No accounts, no tracking cookies."; right — "Contact" link and "Request a feature" button (opens modal).
2. **Header:** logo (droplet icon in a rounded blue square + wordmark) linking to `/`. Center/right nav "Sharing modes": **Wi-Fi Share**, **Private Share**, **Create Room**, **Join Room** — each with an icon (wifi, lock, users, log-in). Active route shown as a light-blue pill. Theme toggle button (moon/sun) at the far right.
   - **Mobile:** nav collapses to short labels: *Wi-Fi · Private · Room · Join* (icon + short label, e.g. a bottom or compact top bar).
3. **Footer:** droplet icon + "© {year} {Brand}. Shared files and text are temporary and deleted automatically." Right: links — Wi-Fi Share, Private Share, Create Room, Join Room, How It Works, About, Contact.
4. "Skip to content" link (accessibility), `<main id="main">`.

### Page list

| Route | Purpose |
|---|---|
| `/` | Wi-Fi Share (main tool) |
| `/private` | Shows spinner "Starting your private share…", creates a session via API, then `router.replace('/s/{token}')` |
| `/s/[token]` | Private Share session page |
| `/room/new` | Spinner "Creating your room…", creates room, redirects to `/r/[token]` |
| `/r/[token]` | Room page |
| `/room/join` | Card: "Join Room" / "Enter the code from the person who created it." / 6-digit input / "Join →" button |
| `/j/[code]` (join link) | Resolves a 6-digit code → redirects to `/r/[token]` |
| `/f/[fileId]` | **Direct link to a single file** (download page for just that file) |
| `/how-it-works` | Explainer + 3 steps + guides list + FAQ accordion (SEO) |
| `/guides/[slug]` | SEO articles (6 of them, see §7) |
| `/about` | Team/makers page |
| `/contact` | Contact form |
| `/privacy`, `/terms` | Add these (reference doesn't show them in footer, but you should) |
| `not-found`, `expired` states | "This share has expired" page |

---

## 4. Main tool UI (shared by Wi-Fi, Private, Room pages)

All three share pages use the **same layout component** with mode-specific hero text and status card.

### 4.1 Hero
- H1 + subtitle + a row of 3 small feature chips (icon + text).
- **Wi-Fi:** "Same Wi-Fi? Just Drop It" / "Share files and text with anyone on the same Wi-Fi network." Chips: *Auto-detects your Wi-Fi, zero setup* · *Direct link to just one file* · *Searchable codes for busy networks*. Below: status pill with green dot **"Wi-Fi Sharing Active"** + button **"Open on another device"** (opens QR modal).
- **Private:** "Just Between You Two" / "Only devices with this link or QR code can access this session." Chips: *Private link, never broadcast to a network* · *One scan auto-connects both sides* · *Grab one file without opening the rest*.
- **Room:** "One Code, Everyone's In" / "Anyone with the room code can join and share files and text." Chips: *One code invites the whole group* · *Sticks around up to 48 hours* · *Everyone can add or remove files*.

(Write your own wording — these show intent.)

### 4.2 Status card (Private & Room only)
- **Private:** QR code (left) | green dot "Session active · Expires in 1 h 59 min" | monospaced read-only URL field + **Copy link** button.
- **Room:** QR code (left) | label "Room code" + big monospaced **6-digit code** (letter-spaced, e.g. `868016`) + copy icon | green dot "Room active · Expires in 23 h 59 min" | **Copy join link** button on the right.
- Countdown updates live (every 30–60 s).

### 4.3 Two-panel share card (side by side on desktop, stacked on mobile)

**Left – Share Files** (header shows keyboard hint `Ctrl + V`)
- Dashed drop zone: upload icon, "Drop files here" (mobile: "Tap to choose files"), **Choose Files** button, hint "Up to 10 GB per file". Hidden `<input type="file" multiple>`.
- Whole page also accepts drag-and-drop (show overlay) and **Ctrl/Cmd+V paste** of files/screenshots from clipboard.
- Below: empty-state text "Files shared on this Wi-Fi / in this session / in this room appear here."
- **File list item:** file-type icon/thumbnail (image preview for images), name, size, "added X min ago", expiry countdown, short **search code** (Wi-Fi mode), actions: **Download**, **Copy direct link** (`/f/{id}`), **Delete** (uploader always; in rooms everyone can delete). Live **upload progress bar** with %, speed, and **Cancel**.
- "Download all" (zip) when ≥2 files.

**Right – Share Text** (header hint `Ctrl + Enter to share`)
- Textarea placeholder "Paste or type text to share…". Buttons: **Clear** (secondary), **Share Text →** (primary). Ctrl/Cmd+Enter submits.
- Empty state: "Text shared on this Wi-Fi appears here."
- **Text item:** content (auto-linkified URLs, clickable), timestamp, **Copy** button (with "Copied!" feedback), delete, expand/collapse for long text. Limit e.g. 50 000 chars.

### 4.4 Footer info row (under the card)
- Left: info icon + scope warning ("Anyone on this Wi-Fi can access shared files and text." / "Anyone with this link can access this session." / "Anyone with the room code can access this room.")
- Right: 3 chips — *10 GB max per file* · *Expires 2h after adding* (or *2–6h* / *24–48h*) · *No registration*.

### 4.5 Modals
- **Open on another device:** title "Open {Brand} on another device", large QR of the current URL, caption "Scan with a phone or laptop on the same Wi-Fi. It opens straight into this space.", read-only URL, **Copy link** button. Close with ×, Esc, backdrop click.
- **Request a feature:** textarea "What should {Brand} do that it doesn't yet?", optional email input, primary **Send request** button (paper-plane icon). Toast on success.

### 4.6 Visual design
- Clean, minimal, lots of whitespace; centered max-width container (~1000 px).
- Primary color: sky/bright blue (`#3B9EF5`-ish); success green dot; neutral grays; rounded-xl cards with subtle border + soft shadow; very light gradient page background.
- Font: Inter / Geist (UI) + a monospace (Geist Mono / JetBrains Mono) for codes, URLs, and `kbd` hints.
- Dark mode: near-black navy background (`#0B0F17`), slightly lighter cards, same blue accent. Respect `prefers-color-scheme`, persist choice in `localStorage` (no cookies), avoid flash with an inline script in `<head>`.
- Fully responsive, 44 px touch targets, visible focus rings, `aria-live` for upload status and new items.

---

## 5. Core behaviour & business logic

### 5.1 Wi-Fi Share (same-network detection)
- Server reads client public IP (`x-forwarded-for` first entry / `x-real-ip` / Vercel `request.ip`).
- **Network ID** = `base64url(HMAC_SHA256(SERVER_SECRET, normalizedIp)).slice(0, 22)` — never store raw IPs.
  - IPv4: use full address. IPv6: use the **/64 prefix** (devices on the same Wi-Fi share a /64 but have different full addresses). Handle dual-stack: optionally store both v4 and v6 keys per client so a phone on v6 and a laptop on v4 still meet (advanced; see §9 "network pairing").
- `GET /api/wifi` → `{ ok, data: { kind: "network", id, expiresAt, files: [...], texts: [...] } }`. Client polls every 3 s while tab visible, 15 s when hidden (use `visibilitychange`), exponential backoff on errors.
- Each item expires **2 h after being added**. Items are visible to all clients with the same network ID.
- **Searchable codes:** each Wi-Fi item gets a short code (e.g. 4 chars, `A7KQ`, no ambiguous chars `0/O/1/I`). On busy networks (café, campus) many items appear; show a search box once > 5 items that filters by code or filename.
- Warn clearly: anyone on the same network sees these items → suggest Private Share for sensitive files.

### 5.2 Private Share
- `POST /api/sessions` → creates session with **256-bit random token** (`crypto.randomBytes(32).toString('base64url')`) → returns `{ token, expiresAt }`. Lifetime 2 h; auto-extend on activity up to 6 h max.
- Page `/s/[token]` polls `GET /api/sessions/{token}`. Unknown/expired token → "expired" state with CTA "Start a new private share".
- "One scan auto-connects both sides": scanning the QR opens the exact URL — no extra step.

### 5.3 Rooms
- `POST /api/rooms` → token (256-bit) + unique **6-digit numeric code** (retry on collision among *active* rooms). Lifetime 24 h, extendable with activity up to 48 h.
- `POST /api/rooms/join { code }` → `{ token }` → redirect to `/r/{token}`. Rate-limit join attempts per IP (e.g. 10/min, 50/hour) to prevent code brute-forcing.
- Join link format: `/j/{code}`; QR encodes the join link.
- Everyone in the room can add **and remove** any file/text.

### 5.4 File upload flow (direct-to-storage)
1. Client: `POST /api/uploads/init { scope: {kind, id/token}, name, size, mime }` — validate size ≤ 10 GB, name sanitized, scope exists & not expired, rate limits.
2. Server creates DB row `status='uploading'`, starts **S3 multipart upload**, returns `{ fileId, uploadId, partSize, partUrls[] }` (presigned PUT URLs; part size 10–64 MB; for big files return URLs in batches via `POST /api/uploads/{id}/parts`).
3. Client uploads parts in parallel (3–4 concurrent) with `XMLHttpRequest` for progress events; retries failed parts (3×); supports cancel (`AbortController` + `POST /api/uploads/{id}/abort`).
4. `POST /api/uploads/{id}/complete { parts:[{PartNumber, ETag}] }` → server completes multipart, marks `status='ready'`.
5. Small files (< 10 MB): single presigned PUT is fine.
- R2/S3 bucket CORS must allow `PUT` from your origin and expose the `ETag` header.

### 5.5 Download flow
- `GET /api/files/{id}/download` → verifies scope access → 302 to a short-lived (5–10 min) presigned GET URL with `Content-Disposition: attachment; filename*=UTF-8''...`.
- `/f/{fileId}` page: single-file view (name, size, expiry, Download button, image/video/PDF preview) — the "direct link to just one file" / "grab one file without opening the rest" feature. File IDs must be random (≥128-bit), not sequential.

### 5.6 Text sharing
- `POST /api/texts { scope, content }` (max 50k chars, trimmed, non-empty). Render as plain text (never `dangerouslySetInnerHTML`), linkify with a safe library (`linkify-it`) and `rel="noopener noreferrer nofollow"`.

### 5.7 Deletion & expiry
- `DELETE /api/files/{id}` / `DELETE /api/texts/{id}`: in Wi-Fi & Private, allow the uploader (identified by an anonymous device ID in `localStorage`, sent as header `X-Device-Id`, plus a per-item `deleteToken` returned at creation) — in Rooms allow any member.
- Cron `/api/cron/cleanup` (protected by `CRON_SECRET`): delete expired DB rows, delete storage objects, abort stale multipart uploads (> 24 h). Bucket lifecycle rule as backup.
- UI hides items client-side as soon as `expiresAt` passes.

---

## 6. Data model (Postgres / Drizzle)

```ts
spaces {            // one table for all three modes
  id            uuid pk
  kind          'network' | 'session' | 'room'
  key           text unique      // networkId hash | session token | room token
  roomCode      char(6) null     // rooms only; unique among active rooms (partial index)
  createdAt     timestamptz
  expiresAt     timestamptz
  maxExpiresAt  timestamptz      // hard cap (6h session / 48h room)
}

files {
  id            text pk          // random 22-char base64url
  spaceId       uuid fk -> spaces
  shortCode     varchar(6)       // searchable code (wifi)
  name          text
  size          bigint
  mime          text
  storageKey    text
  uploadId      text null
  status        'uploading' | 'ready' | 'failed'
  uploaderDevice text            // hashed device id
  deleteTokenHash text
  createdAt, expiresAt timestamptz
}

texts {
  id, spaceId, shortCode, content text, uploaderDevice, deleteTokenHash, createdAt, expiresAt
}

feedback { id, type 'contact'|'feature', message, email null, createdAt }
```
Indexes: `spaces(key)`, `files(spaceId, createdAt desc)`, `texts(spaceId, createdAt desc)`, `files(expiresAt)`, `texts(expiresAt)`.

---

## 7. Content pages (SEO matters a lot for this product)

### `/how-it-works`
- Intro paragraph: free, browser-based, up to 10 GB, phone/PC/iPhone/Android/Mac/tablet, no app/cable/account, same Wi-Fi auto, different networks via QR or 6-digit code, auto-deleted.
- **3 steps:** (1) Open on both devices, (2) Add files or text (drag & drop, Choose Files, paste; live progress), (3) Download on the other device (appears within seconds; auto-deleted on expiry).
- **Guides** list linking to `/guides/*`:
  - send files from phone to PC without a cable
  - transfer photos/files iPhone → Windows PC
  - AirDrop alternative for Android & Windows
  - Snapdrop / PairDrop / LocalSend alternative that works across networks
  - share text & links between phone and computer (online clipboard)
  - free online file sharing with no sign-up
- **FAQ accordion** (`<details>` elements) + `FAQPage` JSON-LD. Questions to cover: what is it; phone→PC without cable/app; iPhone→Windows; AirDrop for Android/Windows; sharing text/links; sharing with QR; do both devices need same Wi-Fi (only for Wi-Fi Share); is it free/no sign-up; file size & retention (10 GB; private 2 h, rooms 24 h, Wi-Fi items 2 h); alternative to Snapdrop/PairDrop/LocalSend; is it secure (256-bit random tokens, HTTPS direct to storage, auto-deletion, Wi-Fi items visible to network → use Private/Room for sensitive files).

### SEO checklist
- Per-page `metadata` (title like "Send Files From Phone to PC Online, Free & No App | Brand"), description, canonical, Open Graph + Twitter image (generate with `next/og`).
- `sitemap.ts`, `robots.ts` (disallow `/s/`, `/r/`, `/f/`, `/api/`), `noindex` on share pages.
- JSON-LD: `WebApplication`, `FAQPage`, `Organization`, `Article` for guides.
- `manifest.webmanifest` + icons (PWA-ready).

### `/about`
Headline, short mission ("moving a file shouldn't be a whole process; no paid plans, no unnecessary accounts, no tracking"), team cards (photo, name, role, one-liner) — **use your own team**. CTA "Got feedback? Come say hi." → Contact.

### `/contact`
Form: Message (textarea, required), Your email (optional), **Send message**. Honeypot field + rate limit. Success toast.

---

## 8. API reference (all JSON, shape `{ ok, data } | { ok:false, error }`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/wifi` | Resolve network from IP; return space + items |
| POST | `/api/sessions` | Create private session |
| GET | `/api/sessions/:token` | Session + items |
| POST | `/api/rooms` | Create room → `{token, code, expiresAt}` |
| POST | `/api/rooms/join` | `{code}` → `{token}` (rate-limited) |
| GET | `/api/rooms/:token` | Room + items |
| POST | `/api/uploads/init` | Start upload (single or multipart) |
| POST | `/api/uploads/:id/parts` | More presigned part URLs |
| POST | `/api/uploads/:id/complete` | Finish multipart |
| POST | `/api/uploads/:id/abort` | Cancel |
| GET | `/api/files/:id` | File metadata (for `/f/:id`) |
| GET | `/api/files/:id/download` | 302 → presigned GET |
| DELETE | `/api/files/:id` | Delete |
| POST | `/api/texts` | Create text |
| DELETE | `/api/texts/:id` | Delete text |
| POST | `/api/feedback` | Contact / feature request |
| GET | `/api/cron/cleanup` | Cron, `Authorization: Bearer CRON_SECRET` |

Scope is passed as `{ kind: 'network' }` (server derives from IP), `{ kind: 'session', token }` or `{ kind: 'room', token }`.

---

## 9. NEW features (our additions beyond the reference)

Pick and prioritize; each is independent. Suggested order is the numbering.

1. **Realtime updates** — replace polling with SSE (`/api/stream?scope=...`) or Pusher/Ably channels; instant "new file" appearance + optional browser notification & sound.
2. **Password-protected shares** — optional password on Private sessions/rooms/single files (argon2/bcrypt hash; unlock via signed short-lived cookie-less token in memory).
3. **End-to-end encryption (E2EE) option** — encrypt files in the browser with AES-GCM (WebCrypto) in chunks; key lives in the URL **fragment** (`#k=...`) so the server never sees it. Show a lock badge.
4. **Custom expiry & download limits** — choose 10 min / 1 h / 2 h / 24 h / 7 days; "burn after N downloads" (e.g. 1 download = self-destruct).
5. **Peer-to-peer direct transfer (WebRTC)** — for same-Wi-Fi or online-together devices, send files P2P without uploading to storage (faster, unlimited size); fall back to cloud upload. Signaling via the realtime channel.
6. **Folder upload & auto-zip** — `webkitdirectory` support; "Download all as ZIP" streamed with `client-zip` in the browser.
7. **Rich previews** — image gallery lightbox, video/audio player, PDF viewer, code/text file viewer with syntax highlighting.
8. **Device names & presence** — auto-generated friendly names ("Blue Fox – iPhone"), show "3 devices online" in a space, and "send to a specific device" in Wi-Fi mode.
9. **Clipboard sync mode** — one-tap "send clipboard" and "copy latest" buttons; keyboard shortcut `Ctrl+Shift+V`.
10. **PWA + Share Target** — installable app; register as a share target on Android so users can "Share → Dropzy" from any app. Offline shell.
11. **Resumable uploads** — persist multipart state in IndexedDB; resume after network drop or page refresh.
12. **Image compression option** — "Send original" vs "Reduce size" (browser-side via canvas / `browser-image-compression`).
13. **Short human links** — `/s/{word-word-number}` alternative that's easy to type on another device (still rate-limited & long enough).
14. **Share history (local only)** — list of your recent sessions/rooms stored in `localStorage` with quick re-open.
15. **i18n** — English + Urdu (RTL support) + more using `next-intl`.
16. **Abuse & safety** — malware scan on upload (ClamAV worker or VirusTotal hash lookup), report-abuse button on `/f/:id`, block list of hashes, CSAM/abuse policy page, Cloudflare Turnstile only after suspicious volume.
17. **Optional accounts (Pro tier, later)** — longer retention, bigger files, custom room codes, branded pages. Keep the free no-account flow as default.
18. **Admin dashboard** — `/admin` (protected) with active spaces, storage usage, feedback inbox, abuse reports, manual delete.

---

## 10. Security & privacy requirements

- Tokens: 256-bit random (sessions, rooms), ≥128-bit (file IDs). Compare with constant-time where relevant.
- Never store raw IPs; HMAC them with a server secret; rotate-safe.
- Strict input validation (zod), filename sanitization, max lengths.
- Rate limits: uploads init (e.g. 60/h/IP), total bytes per IP per day (e.g. 50 GB), text posts (30/min), room join (10/min), feedback (5/h).
- Security headers: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (keeps tokens out of referrers), HSTS, `frame-ancestors 'none'`.
- Downloads always `Content-Disposition: attachment` for non-previewable types; serve previews from the storage domain, never your app origin (avoid stored XSS via HTML/SVG uploads).
- No tracking cookies; theme & device ID in `localStorage` only.
- Privacy policy + terms pages describing auto-deletion and prohibited content.

---

## 11. Environment variables

```
DATABASE_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
S3_ENDPOINT=              # R2: https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
IP_HASH_SECRET=           # 32+ random bytes
CRON_SECRET=
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
RESEND_API_KEY=           # optional
FEEDBACK_TO_EMAIL=        # optional
```

---

## 12. Suggested project structure

```
app/
  (marketing)/how-it-works/page.tsx
  (marketing)/guides/[slug]/page.tsx
  (marketing)/about/page.tsx
  (marketing)/contact/page.tsx
  page.tsx                      # Wi-Fi Share
  private/page.tsx              # creates session → redirect
  s/[token]/page.tsx
  room/new/page.tsx
  room/join/page.tsx
  r/[token]/page.tsx
  j/[code]/route.ts             # join-link redirect
  f/[fileId]/page.tsx
  api/...                       # see §8
  layout.tsx, not-found.tsx, sitemap.ts, robots.ts, opengraph-image.tsx
components/
  layout/ (AnnouncementBar, Header, MobileNav, Footer, ThemeToggle)
  share/  (ShareShell, Hero, StatusCard, FilePanel, DropZone, FileItem,
           UploadProgress, TextPanel, TextItem, InfoRow, QrModal, SearchBox)
  modals/ (FeatureRequestModal)
  ui/     (Button, Card, Kbd, Toast, Dialog, Input, Spinner)
lib/
  db/ (schema.ts, client.ts)   storage/ (s3.ts, multipart.ts)
  network.ts (ip → networkId)  tokens.ts  ratelimit.ts  validation.ts
  hooks/ (useSpacePolling, useUploader, useCountdown, usePasteUpload)
content/guides/*.mdx
```

---

## 13. Build phases (give these to Claude Code one at a time)

1. **Scaffold** — Next.js + TS + Tailwind + lucide; global layout (announcement bar, header w/ active nav + mobile nav, footer, theme toggle with no-flash script); static placeholder pages for every route.
2. **Share UI (static)** — ShareShell with hero variants, two-panel card, drop zone, text panel, info row, QR modal, feature-request modal. Keyboard shortcuts (Ctrl+V paste, Ctrl+Enter). Responsive + dark mode.
3. **Database & spaces** — Drizzle schema, `/api/wifi`, sessions, rooms (create/join/get), redirect pages with spinners, countdown, expired state.
4. **Text sharing** — create/list/delete texts, polling hook, linkify, copy feedback.
5. **File uploads** — R2 setup + CORS, init/multipart/complete/abort, progress/speed/cancel, retries; list, download, delete; `/f/[id]` single-file page; search codes + search box.
6. **Cleanup & hardening** — cron, lifecycle rule, rate limiting, security headers, validation, error toasts, empty/loading states.
7. **Content & SEO** — How It Works, FAQ + JSON-LD, 6 guides (MDX), About, Contact, metadata, OG images, sitemap/robots, manifest.
8. **New features** — implement §9 items in the chosen order.
9. **QA** — Playwright e2e: two browser contexts share text/file in each mode; room join by code; expiry; mobile viewport; dark mode; Lighthouse ≥ 90.

---

## 14. Acceptance criteria (definition of done)

- Opening `/` on two devices on the same Wi-Fi shows the same items within ≤ 5 s (≤ 1 s with realtime).
- Private link and QR open the same session on another network; room joins via 6-digit code, join link, and QR.
- A 5 GB file uploads with visible progress, survives a single failed part, and downloads intact (checksum match).
- Text with a URL renders as a safe clickable link; Copy works on iOS Safari and Android Chrome.
- Items disappear from UI at expiry and from DB + storage within 10 min after.
- Room code brute force is throttled; invalid/expired tokens show a friendly expired page.
- No cookies set (except strictly necessary if any); raw IPs never persisted.
- Works on latest Chrome, Safari (iOS/macOS), Firefox, Edge; layout correct at 360 px width; dark mode everywhere.
