# SPEC.md — Dropzy

**Free, friendly file & text sharing between any devices, in the browser.**

> **How to use with Claude Code:** put this file in the repo root as `SPEC.md`, then say:
> *"Read SPEC.md end to end. Build it phase by phase (§17). After each phase, stop, tell me exactly what to test, and wait."*
>
> **Rules for Claude Code**
> 1. Build only what's described here. §18 lists the backlog and out-of-scope items — don't build them unless asked.
> 2. Platform limits and APIs were checked in September 2026 (§20). If current docs disagree with this spec, follow the docs and tell me what changed.
> 3. Keep every user-facing string in `apps/web/src/strings/en.ts`, using the wording in §6.4.
> 4. "Dropzy" is a placeholder brand. Don't copy the reference site's (dropinn.tech) name, logo, text or team page.
> 5. When something isn't specified, pick the option with fewer network requests, fewer dependencies and fewer UI controls.

---

## 0. Summary

Dropzy moves files and text between devices — phone ↔ PC, iPhone ↔ Windows, Android ↔ Mac — in the browser, with no app and no account. When the other device is online, files go **directly** between the two browsers and are never uploaded. Otherwise they're **uploaded** for a few hours and deleted automatically. The whole thing runs on free tiers.

## 1. Goals

In priority order:

1. **Friendly and easy.** Opening the page is the whole setup.
2. **Free to run, for as many people as possible.** Everything fits free tiers; near a limit, the app degrades gracefully instead of costing money (§4.5).
3. **Private by default.** Everything is temporary, Private Share is end-to-end encrypted, no cookies, raw IPs are never stored.
4. **Lean.** No accounts, no settings pages, no heavy libraries.

**UX rules for every screen**

- One obvious next step.
- Plain words — the UI never says P2P, WebRTC, E2EE, presigned, WebSocket or OPFS (§6.1).
- Forgiving — retries and fallbacks are automatic, deletes can be undone for 5 s, typed text is never lost.
- Visible state — who's here, what's sending, how fast, how long things last.
- Privacy in one line — say who can see something where it matters; no walls of warnings.
- Mobile first — bottom nav, 44 px touch targets, flawless at 360 px wide.
- Fast — content pages ship almost no JavaScript; the app is usable within 2 s on a mid-range phone on 4G.
- Accessible — keyboard, screen readers (`aria-live` for new items and progress), visible focus, AA contrast, `prefers-reduced-motion`.

## 2. Modes

| | **Wi-Fi Share** (home, `/`) | **Private Share** (`/s/{token}#k={key}`) | **Room** (`/r/{token}`) |
|---|---|---|---|
| Who's in | Everyone on the same network, automatically | Anyone with the link or QR | Anyone with the 6-digit code, link or QR |
| Best for | Your own devices at home or work | You + one person, or your devices on different networks | Groups |
| Lifetime | Each item: 2 h after it's added | 2 h · **Extend** +2 h · max 6 h | 24 h · **Extend** +24 h · max 48 h |
| Files go | Directly if exactly one other device is here, else uploaded | Directly if exactly one other device is here, else uploaded | Always uploaded, so latecomers get them |
| Encryption | In transit (HTTPS / WebRTC) | **End-to-end** — the key lives in the link | In transit |
| Who can delete | Only the device that added it | Anyone in the share | Anyone in the room |
| Extras | 4-character search codes, busy-network mode, connect-a-device code | Single-file links that carry their own key | Lock room |

## 3. v1 features

**Kept from the reference:** the three modes, text sharing, file sharing (drag & drop, picker, paste), single-file links, QR codes, search codes, "download all", dark mode, content and SEO pages.

**New in Dropzy:**

1. **Realtime** — one WebSocket per tab; items and devices appear instantly; tab-title badge for background tabs (§8).
2. **Devices here** — friendly device names and presence, plus a "Waiting for your other device…" card (§6.3).
3. **Direct transfer** — browser-to-browser over WebRTC when possible, automatic fallback to upload (§9).
4. **Connect a device** — a QR and 6-digit pair code that work even when Wi-Fi detection fails (§7.1).
5. **Busy-network mode** — hides other people's items on crowded or shared-IP networks (§7.1).
6. **Honest timers + Extend**, and **Lock room** (§7).
7. **End-to-end encryption** for Private Share (§10).
8. **Delete after first download** (§9.7).
9. **Save to Photos** on iPhone/iPad (§9.5).
10. **Text extras** — show text as a QR, Paste & send, Copy latest (§11).
11. **Safety basics** — report button, fast takedown, small admin page, rate limits, cost guard (§14).

## 4. Architecture for free hosting

### 4.1 Shape

```
Browser
 ├─ pages & JS ────────────► Vercel (Hobby): Astro static site. Zero Vercel Functions.
 ├─ WebSocket + small API ─► Cloudflare Worker "dropzy-api" (Free plan, *.workers.dev)
 │                             ├─ SpaceDO      one Durable Object per Wi-Fi network / private share / room
 │                             ├─ DirectoryDO  room codes + pair codes          (single instance)
 │                             ├─ GuardDO      quotas, cost guard, blocklist    (single instance)
 │                             └─ AdminDO      reports + feedback               (single instance)
 ├─ file bytes ────────────► Cloudflare R2 via short-lived signed URLs (never through our code)
 └─ direct transfer ◄──────► the other browser (WebRTC data channel; STUN: stun.cloudflare.com)
```

Three separate origins: the app (your domain on Vercel), the API (`*.workers.dev`), and file bytes (`*.r2.cloudflarestorage.com`). A bad upload can't get the main site flagged, and uploaded files can never run as pages on the app's origin.

### 4.2 Why this shape

- **Vercel stays static.** Vercel Functions now accept WebSockets (public beta), but each connection is pinned to one instance and closes at the function's max duration, reconnects can land on a different instance (so presence and rooms would need an external Redis), and open connections count as Function usage. A Durable Object gives each space exactly one coordinator, and with the Hibernation API idle connections cost no compute time.
- **Astro, not Next.js.** The tightest Vercel Hobby limit is edge requests, and every JS chunk, stylesheet and font file is one. Astro content pages ship as a single HTML file; app pages add 2–3 JS files. A Next.js static export would work but typically needs several times more requests per visit.
- **Bytes never touch our code.** Uploads and downloads go browser ↔ R2 (free egress) or browser ↔ browser.

### 4.3 Free-tier limits (checked September 2026)

| Service | Free allowance | Past the limit | How we stay under |
|---|---|---|---|
| **Vercel Hobby** | 1M edge requests/month, 100 GB fast data transfer/month. Non-commercial use only | You wait until 30 days have passed to use that feature again | Static only; ≤ 5 requests on a first visit (§4.4); immutable caching |
| **Workers Free** | 100k requests/day, 10 ms CPU per request. A WebSocket counts once (the upgrade); its messages don't. Static assets are free and unlimited | Errors until 00:00 UTC | Everything after page load goes over the one WebSocket |
| **Durable Objects Free** (SQLite only) | 100k requests/day (HTTP, RPC calls, alarms; incoming WebSocket messages count 20:1; outgoing are free) · 13,000 GB-s/day duration (idle, hibernation-eligible objects aren't billed) · 5M rows read/day, 100k rows written/day, 5 GB stored · each `setAlarm` = 1 row written; deletes count as writes | Errors until 00:00 UTC | Hibernation API, no timers, no secondary indexes, presence kept in socket attachments (§8.5) |
| **R2** | 10 GB-month storage, 1M Class A (write) ops/month, 10M Class B (read) ops/month, free egress. Activating R2 asks for a payment method | **Billed** | GuardDO pauses uploads well before the limits (§14.4); direct transfer is tried first |
| **STUN** | `stun.cloudflare.com` — free, unlimited | — | — |
| **TURN** (optional, off) | Cloudflare Realtime TURN: 1,000 GB/month free | Billed | `TURN_ENABLED=false` by default |
| **Rate limiting binding** | Workers Rate Limiting (GA); per location, approximate; period 10 s or 60 s | — | Per-IP limits; exact counters live in DOs |

### 4.4 Per-visit budget (measure these in QA)

| Resource | Target for a typical visit |
|---|---|
| Vercel edge requests | ≤ 5 on a first visit to `/`; ≤ 2 on content pages; ≤ 2 on repeat visits |
| Worker requests | ≤ 3 (WebSocket upgrade + at most 2 HTTP calls) |
| Durable Object billed requests | ≤ 8 |
| SQLite rows written | ≤ 10 |
| R2 operations | 0 for text and direct transfers |

At these targets the free tiers handle roughly **5,000–10,000 active visits a day**. The first ceilings are Vercel edge requests and Durable Object requests / rows written.

How to hit them:

- Astro `build.inlineStylesheets: 'always'`; tiny vanilla scripts use `is:inline`; system font stack (no web fonts); favicon as an inline SVG data URI; icons as inline SVG; hashed assets cached for a year.
- No analytics scripts, no prefetching.
- Lazy-load anything not needed for first paint (QR, zip, direct transfer, crypto).
- Heartbeat only every 60 s while visible and every 5 min while hidden (§8.4).

### 4.5 Graceful degradation — never surprise-bill, never dead-end

- **`STORAGE_ENABLED=false`** (no R2, e.g. no card): *direct-only mode*. Text works everywhere; files go directly to each device currently in the space (max 4, never on busy networks); nothing is stored. Upload-only UI (one-download toggle, "available for…", Copy link) is hidden.
- **Cost guard trips** (§14.4): uploads pause until the next UTC day ("Uploads are paused for today…"); text and direct transfer keep working.
- **Workers / DO daily limit hit**: the app shows "Dropzy is at capacity for today. It'll be back at {local time of the next 00:00 UTC}." Content pages keep working because they're static.

### 4.6 Growing past free (later)

- Cloudflare Workers Paid ($5/month) removes the daily caps: 10M Worker requests, 1M DO requests and 400k GB-s per month included, then pay-as-you-go.
- If Vercel's edge-request cap becomes the limit, deploy the same static build to Cloudflare (static asset requests are free and unlimited) — no code changes — or move to Vercel Pro. Vercel Hobby is non-commercial only, so if you ever add ads or payments, move anyway.
- R2 beyond free: $0.015/GB-month, $4.50 per million Class A, $0.36 per million Class B.

## 5. Stack and repo

```
dropzy/
  SPEC.md · SETUP.md (write it from §16) · package.json (pnpm workspaces)
  apps/web/                     Astro (static) + React islands + Tailwind CSS v4 + TypeScript
    astro.config.mjs            output 'static', @astrojs/react, @tailwindcss/vite, @astrojs/mdx, @astrojs/sitemap
    vercel.json                 rewrites + headers (§16.3)
    src/layouts/Base.astro      <head>, no-flash theme script, top bar, header, bottom nav, footer
    src/pages/                  index (Wi-Fi) · private · s/index · room/new · r/index · join/index · f/index
                                how-it-works · guides/[slug] · about · contact · privacy · terms · 404 · admin/index
    src/content/guides/*.mdx
    src/components/site/        Header, BottomNav, Footer, ThemeToggle, FeatureDialog   (vanilla JS, no React)
    src/components/share/       ShareApp.tsx (island root), Hero, DevicesBar, ConnectCard, StatusCard,
                                FilesPanel, DropZone, FileItem, TextPanel, TextItem, InfoRow, SearchBox,
                                Banners (Busy, Expiry, Offline, Capacity), Dialogs, Toasts
    src/lib/                    api.ts · socket.ts · store.ts · device.ts · upload/ · direct/ · sink/ · crypto/
                                thumbs.ts · zip.ts · qr.ts · linkify.tsx · format.ts · shortcuts.ts · badge.ts
    src/strings/en.ts
  apps/api/                     Cloudflare Worker (Hono) + Durable Objects (SQLite) + aws4fetch + zod
    wrangler.jsonc
    src/index.ts                routing, CORS, Origin checks, rate limits
    src/ip.ts · tokens.ts · r2.ts
    src/space/SpaceDO.ts · directory/DirectoryDO.ts · guard/GuardDO.ts · admin/AdminDO.ts
  packages/shared/src/          protocol.ts (§8) · constants.ts · codes.ts · sizes.ts · names.ts · mime.ts
```

- **Web dependencies:** react, react-dom, lucide-react, linkify-it, qrcode (lazy), client-zip (lazy). State: a small store with `useSyncExternalStore`. No UI kit, no animation library.
- **Content pages** (how it works, guides, about…) render with zero React; header, theme toggle and feature dialog are vanilla JS.
- **Worker dependencies:** hono, aws4fetch, zod. Validate every input on the server; the client uses the shared TypeScript types.
- **Tests:** vitest, `@cloudflare/vitest-pool-workers`, Playwright.

## 6. UX

### 6.1 UI vocabulary

| Internally | In the UI |
|---|---|
| WebRTC transfer | "Sending directly" · "Sent directly — never uploaded" |
| R2 upload | "Uploading" · "Available for 1 h 42 min" |
| E2EE | "End-to-end encrypted" (lock icon) |
| Presence | "Devices here" |
| Public-network mode | "Busy network" |
| Network pass / pair code | "Connect a device" |
| Space expired | "This share has ended" |

### 6.2 Global layout

- **Top bar** (thin, muted): "No sign-up · No tracking · Everything deletes itself". Right side: Contact · **Request a feature** (native `<dialog>`: textarea "What would make Dropzy better for you?", optional email, **Send** → `/v1/feedback`, toast).
- **Header:** logo (droplet in a rounded blue square + wordmark) → `/`. Nav: Wi-Fi · Private · Room · Join (icon + label; the active page is a light-blue pill). Theme toggle.
- **Mobile:** the nav becomes a bottom tab bar (icon + short label).
- **Footer:** "© {year} Dropzy · Everything you share here deletes itself." Links: Wi-Fi Share, Private Share, Create Room, Join Room, How it works, About, Contact, Privacy, Terms.
- Skip link; `<main id="main">`.

### 6.3 Share screen (one component for all three modes)

Top to bottom:

**1. Hero** — H1, one-line subtitle, 3 chips (chips hidden on mobile). Write your own copy; suggestions:

- Wi-Fi — "Open it on both devices. That's it." / "Everything shared on this Wi-Fi shows up here — and goes straight across when it can." Chips: Finds your devices by itself · Sends directly when it can · Nothing to install
- Private — "A private line between two devices." / "Only someone with this link can get in, and everything is encrypted end to end." Chips: End-to-end encrypted · Link or QR only · Share one file on its own
- Room — "A room for your group." / "Share the 6-digit code; everyone can add, grab and remove files." Chips: Join with a code · Lasts up to 48 hours · Lock it when everyone's in

**2. Devices bar** — each device as emoji avatar + name + type ("🦊 Blue Fox · iPhone"); yours first, marked "(you)"; tap yours to rename. More than 6 → "+3". On a busy network, only "12 devices on this network". Toast when someone arrives: "Blue Fox (iPhone) is here".

**3. Connect card** — shown while you're alone (Wi-Fi: after 8 s; Private and Room: right away). Once someone else is here it collapses to a **Connect a device** button.

- Wi-Fi: "Waiting for your other device…", a QR (network pass), a 6-digit pair code, and two lines: "Open dropzy.app on your other device — it should appear here." / "Not showing up? Scan this QR, or tap Join and enter {code}." Small link: "On different networks? Start a Private Share".
- Private: QR of the full link + **Copy link**.
- Room: QR of the join link + the big code + **Copy join link**.

**4. Status card** (Private, Room)

- Private: 🔒 "End-to-end encrypted" · "Ends in 1 h 59 min" · **Extend** (+2 h) · link field + **Copy link** · small QR (tap to enlarge).
- Room: big code (letter-spaced monospace) + copy · "Ends in 23 h 59 min" · **Extend** (+24 h) · **Lock room** toggle · **Copy join link**.
- The countdown refreshes every 30 s. At 10 minutes left, a banner: "This share ends in 10 minutes. Keep it longer" (Extend). At the maximum, Extend is disabled with "Maximum length reached".

**5. Two panels** — side by side on desktop, stacked on mobile (Files first).

*Files panel*

- Drop zone: icon, "Drop files here" (mobile: "Tap to choose files"), **Choose files**, and a hint that reflects config ("Direct: no size limit · Uploads: up to 2 GB"). Whole-window drag overlay. Ctrl/⌘+V pastes files and screenshots.
- Chip toggle "Delete after 1 download" — only when uploads are available; off by default; applies to files added while it's on.
- List, newest first. Empty state: "Files you share here show up on your other devices instantly."
- Search box when there are more than 5 items (matches name or code).
- **Download all** when there are 2+ downloadable items.

*File item*

- Thumbnail or type icon · name (middle-ellipsis, extension always visible) · size · from · "2 min ago".
- One status line: "Sending directly · 45% · 12 MB/s" / "Sent directly to Blue Fox ✓" / "Receiving from Blue Fox · 45%" / "Uploading · 45% · 3.2 MB/s · Cancel" / "Blue Fox is uploading… 40%" / "Available for 1 h 42 min" / "Deletes after 1 download".
- Badges: 🔒 (encrypted), code chip (Wi-Fi, e.g. `A7KQ`).
- Actions: **Download** (or **Save** for directly received files) · **Save to Photos** (iPhone/iPad; images and videos) · **Copy link** (uploaded items) · **Delete** (when allowed; Undo toast). Overflow menu: "Make available for later" (your directly sent items), "Report" (other people's items).
- Risky types from others (`.exe .msi .bat .cmd .scr .ps1 .vbs .js .jar .apk .dmg .pkg .sh .app`): confirm first with "Only open files from people you trust."

*Text panel*

- Header buttons: **Paste & send** · **Copy latest**. Textarea "Paste or type text to share…"; **Share** (primary; Ctrl/⌘+Enter) and **Clear**.
- Items: the text (safe links), from + time, **Copy** ("Copied!"), **QR** (texts ≤ 500 chars), Delete (Undo). More than 8 lines → "Show more".
- Empty state: "Text you share here shows up on your other devices instantly."
- The draft survives failures and reloads (sessionStorage, per space).

**6. Info row** — one scope line + 3 chips:

- Wi-Fi: "Everyone on this Wi-Fi can see what's shared here." · Items last 2 hours · Direct when possible · No sign-up
- Private: "Only people with this link can get in." · End-to-end encrypted · Up to 6 hours · No sign-up
- Room: "Anyone with the code can see and change what's here." · Up to 48 hours · Lock anytime · No sign-up

**Also on this screen:**

- Toasts: bottom-center on mobile, bottom-right on desktop, `aria-live="polite"`, max 3, 4 s (Undo toasts 5 s).
- Dialogs close on Esc, backdrop and ×; they trap and restore focus.
- Tab badge: while the tab is hidden and new items arrive, the title becomes "(2) Dropzy" and the favicon gets a dot; cleared on focus.
- An "Offline — reconnecting…" pill whenever the socket is down.

### 6.4 Wording for key moments

| Moment | Text |
|---|---|
| Alone on Wi-Fi | "Waiting for your other device… Open dropzy.app on it and it'll appear here." |
| Device arrives | "Blue Fox (iPhone) is here" |
| Direct failed, uploading instead | "Couldn't connect directly, so we're uploading it instead." |
| Offline during upload | "You're offline. We'll pick up where we left off." |
| Too big to upload, nobody here | "Files over 2 GB can only go directly. Open Dropzy on the other device and keep both open." |
| Uploads paused (cost guard) | "Uploads are paused for today. Sending directly still works — keep both devices open." |
| Uploads off, nobody here | "Open Dropzy on the other device first — files go straight to it." |
| Busy network | "This network is busy, so we've hidden other people's items. Find one by its code, or start a Private Share." |
| Private link without its key | "This link is missing its last part. Ask the sender to copy the whole link again." |
| Ended | "This share has ended and everything in it was deleted." [Start a new one] |
| Wrong code | "No room with that code. Check the digits and try again." |
| Room locked | "This room is locked. Ask someone inside to unlock it." |
| Rate limited | "Slow down a little — try again in a minute." |
| At capacity | "Dropzy is at capacity for today. It'll be back at {time}." |
| Too big for this iPhone | "This file is too big to save in this iPhone's browser. Open the link on a computer." |
| Leaving with unsaved received files | "You have 1 received file you haven't saved." |
| Deleted | "Deleted." [Undo] |

### 6.5 Visual design

- Clean and calm: lots of whitespace, centered container (~1000 px), cards `rounded-2xl` with a 1 px border and soft shadow.
- Colors: sky-blue accent (~`#3B9EF5`), a green "live" dot, neutral grays, a very light gradient background.
- Dark mode: near-black navy (`#0B0F17`), slightly lighter cards, same accent. It follows `prefers-color-scheme`, the toggle is stored in `localStorage`, and an inline `<head>` script prevents a flash.
- Type: system UI font; `ui-monospace` for codes, links and `kbd`.
- Emoji avatars that match each device's animal name.
- Motion: 150–200 ms, and none under reduced motion.

## 7. Spaces and access

### 7.1 Wi-Fi Share

- **Network detection** (Worker): read `CF-Connecting-IP`. IPv4 → the whole address; IPv6 → the first 64 bits. `networkId = base64url(HMAC-SHA256(IP_HASH_SECRET, "net|" + key)).slice(0, 22)`. DO name `net:{networkId}`. Raw IPs are never stored or logged.
- Detection misses (iCloud Private Relay, VPNs, a phone quietly on mobile data, IPv4 vs IPv6) aren't worked around automatically — the Connect card handles them.
- **Connect a device** (`pass.create` over the socket; Wi-Fi only; 5 per 10 min per socket):
  - *Pass*: `base64url(JSON {v:1, n:networkId, exp}) + "." + base64url(HMAC-SHA256(PASS_SECRET, payload))`, valid 2 h. The QR encodes `https://{site}/#p={pass}`. The home page reads `#p`, keeps it in sessionStorage, removes it from the address bar and connects with `scope=pass`. That device shows "Connected by code · Leave"; Leave clears the pass and reconnects normally.
  - *Pair code*: 6 digits stored in DirectoryDO → `{kind:'pass', target: pass}`; valid 10 minutes; single use. It's entered on `/join` like a room code.
- **Search codes**: each Wi-Fi item gets a 4-character code from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, unique among live items in the space.
- **Busy-network mode**:
  - Turns on when 7 or more distinct devices are connected at once (`BUSY_NETWORK_DEVICES`) and stays on for 2 h (`busy_until`).
  - While on: each device only receives its own items plus items it found by code (`find`, 10/min, up to 30 remembered per socket). Presence shows only a count, direct auto-send is off, and the busy banner shows.

### 7.2 Private Share

- `/private` shows "Starting your private share…", calls `POST /v1/sessions` → `{token, expiresAt}`, generates a 256-bit key in the browser, and does a full-page navigation to `/s/{token}#k={key}`.
- Token = 32 random bytes, base64url. DO name `ses:{token}`.
- Lasts 2 h; Extend adds 2 h, up to 6 h after creation.
- Opening the link without `#k` → the "missing its last part" state; nothing is shown.

### 7.3 Room

- `/room/new` shows "Creating your room…", calls `POST /v1/rooms` → `{token, code, expiresAt}`, and navigates to `/r/{token}`.
- Code: 6 random digits (rejection sampling), unique among active codes.
- `/join`: six digit boxes (`inputmode="numeric"`, `autocomplete="one-time-code"`, pasting fills all six, auto-submit on the sixth). `POST /v1/join {code}` returns either `{kind:'room', token}` → go to `/r/{token}`, or `{kind:'pass', pass}` → go to `/#p={pass}`. `/j/{code}` pre-fills and submits.
- **Lock room**: any member can lock or unlock. While locked, joining by code or link fails with the locked message; people already inside stay.
- Lasts 24 h; Extend adds 24 h, up to 48 h after creation.
- Brute-force protection: a Worker rate limit (10 joins/min per IP hash), plus a DirectoryDO global throttle (more than 300 failed lookups in the last minute → delay failures by 1–2 s). Codes die with their room.

### 7.4 Expiry

- SpaceDO keeps a single alarm set to the next expiry (earliest item, space end, one-download grace period, or stale upload). On the alarm:
  - delete expired items and their R2 objects;
  - abort multipart uploads older than 2 h;
  - tell GuardDO the bytes are free.
- If the space itself ended: broadcast `ended`, close sockets (4410), release the room code, then `ctx.storage.deleteAll()`.
- Only call `setAlarm` when the next time actually changes (each call is a billed row write).
- Clients hide items the moment `expiresAt` passes.
- Safety net: R2 lifecycle rules (§16.4).

### 7.5 Device identity

- `deviceId` = 16 random bytes in `localStorage`. It's sent in `hello`; the server keeps only `deviceHash = base64url(SHA-256(deviceId)).slice(0, 16)`.
- Friendly name = adjective + animal from curated, non-offensive lists (64 × 64), e.g. "Blue Fox", with a matching emoji.
- Device type comes from the user agent (iPhone, iPad, Android, Windows PC, Mac, Linux, Chromebook).
- Rename: 1–24 characters.
- Presence uses a random per-connection `peerId`; `deviceId` and `deviceHash` are never sent to other clients.
- Wi-Fi deletes: the server returns a `deleteToken` for your items. The client keeps `{itemId: token}` in `localStorage` until expiry; the server stores only its SHA-256.

## 8. Realtime protocol

### 8.1 Connecting

`GET wss://{API}/v1/ws?scope=wifi|pass|ses|room&id={token|pass}&v=1`

The Worker:

1. checks `Origin` (`SITE_ORIGIN` + `EXTRA_ORIGINS`);
2. applies `RL_CONNECT`;
3. resolves the DO name (wifi → from the IP; pass → verify HMAC and expiry; ses/room → from the token);
4. forwards the upgrade.

The DO rejects unknown or ended spaces. `POST /v1/sessions` and `/v1/rooms` create the space row through an RPC; Wi-Fi spaces are created lazily on first connect.

Close codes: 4400 bad request · 4403 origin/forbidden · 4404 not found · 4410 ended · 4429 rate limited · 4503 at capacity.

The first client message is `hello`, and the server answers with `state`. Any message that carries `rid` gets an `ack`.

### 8.2 Messages (`packages/shared/src/protocol.ts`)

```ts
type DeviceType = 'iphone'|'ipad'|'android'|'windows'|'mac'|'linux'|'chromeos'|'other';
type Peer = { peerId: string; name: string; type: DeviceType };

type SpaceInfo = {
  kind: 'net'|'ses'|'room';
  ref: string;                                   // base64url(DO id) → used to build /f links
  expiresAt?: number; maxExpiresAt?: number;     // ses, room
  code?: string; locked?: boolean;               // room
  busy?: boolean; viaPass?: boolean;             // net
  uploads: 'on'|'paused'|'off';
};

type Item = {
  id: string; type: 'text'|'file'; mine: boolean;
  from: { name: string; type: DeviceType };
  createdAt: number; expiresAt: number; code?: string;
  body?: string;                                 // text (base64 iv|ciphertext when e2ee)
  name?: string; mime?: string; size?: number;   // file; name/mime absent when e2ee
  encMeta?: string; thumb?: string; e2ee?: boolean;
  status?: 'uploading'|'ready'; pct?: number; burn?: boolean;
};

type C2S =
  | { t:'hello'; rid:string; deviceId:string; name:string; type:DeviceType;
      caps:{ direct:boolean; maxDirectBytes:number } }
  | { t:'text.add'; rid:string; cid:string; body:string }
  | { t:'item.delete'; rid:string; id:string; deleteToken?:string }
  | { t:'upload.init'; rid:string; cid:string; size:number; name?:string; mime?:string;
      encMeta?:string; thumb?:string; e2ee:boolean; burn:boolean }
  | { t:'upload.urls'; rid:string; id:string; parts:number[] }
  | { t:'upload.progress'; id:string; pct:number }              // throttled: every 10 % or 5 s
  | { t:'upload.complete'; rid:string; id:string; parts?:{ n:number; etag:string }[] }
  | { t:'upload.abort'; rid:string; id:string }
  | { t:'download.url'; rid:string; id:string }
  | { t:'space.extend'; rid:string }
  | { t:'room.lock'; rid:string; locked:boolean }
  | { t:'pass.create'; rid:string }
  | { t:'find'; rid:string; code:string }
  | { t:'device.rename'; rid:string; name:string }
  | { t:'signal'; to:string; data:{ kind:'offer'|'answer'; sdp:string } | { kind:'bye' } };

type S2C =
  | { t:'ack'; rid:string; ok:true; data?:unknown }
  | { t:'ack'; rid:string; ok:false; error:ErrorCode; retryAfter?:number }
  | { t:'state'; you:{ peerId:string }; space:SpaceInfo; items:Item[]; peers:Peer[] | { count:number } }
  | { t:'item.added' | 'item.updated'; item:Item }
  | { t:'item.removed'; id:string }
  | { t:'peers'; peers:Peer[] | { count:number } }
  | { t:'space'; space:SpaceInfo }
  | { t:'signal'; from:string; data:unknown }
  | { t:'ended' };

type ErrorCode = 'bad_request'|'not_found'|'ended'|'forbidden'|'rate_limited'|'too_large'
  |'space_full'|'uploads_paused'|'uploads_off'|'locked'|'max_length';
```

### 8.3 Reliability

- **Reconnect** with backoff from 0.5 s to 30 s (×2, ±20 % jitter).
  - Reconnect immediately on `online` and when the tab becomes visible.
  - While hidden, wait until the tab is visible.
  - Never close a healthy socket on purpose.
- **After reconnect:** send `hello`; the full `state` replaces the local store.
- **No duplicates:** `text.add` and `upload.init` carry a client id `cid`. The DO ignores a `cid` it already has (a column on `items`), so retries never duplicate.
- **Timeouts:** pending requests time out after 10 s and are retried once if idempotent.

### 8.4 Heartbeat and presence

- **Pings:** the DO sets `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`, so pings never wake it (no duration cost).
  - Pings may still count as incoming messages (20:1). So the client pings every **60 s while visible** and every **5 min while hidden**.
  - No `pong` within 10 s → reconnect.
- **Stale sockets:** whenever the DO wakes, it closes sockets whose `getWebSocketAutoResponseTimestamp()` is older than 6 min, then updates presence. No timers.
- **Presence changes** (connect, close, rename) broadcast `peers`. Outgoing messages are free.

### 8.5 Durable Object rules (MUST)

- SQLite storage backend only (`new_sqlite_classes`) — the free plan requires it.
- Hibernation API only: `ctx.acceptWebSocket(ws, ['peer:' + peerId, 'dev:' + deviceHash])`; never `ws.accept()`. Use tags for targeted sends (`ctx.getWebSockets(tag)`).
- Per-socket state (≤ 2 KB) goes in `serializeAttachment`: `{peerId, deviceHash, name, type, caps, viaPass, found[], buckets}`.
- No `setTimeout` / `setInterval`; use alarms. Nothing may keep the object awake after a handler returns.
- In-memory values are only a cache. Anything needed after hibernation lives in SQLite or attachments.
- No secondary SQL indexes (each index adds billed row writes). Tables stay small: ≤ 200 items per space, ≤ 50 per device.
- Per-socket token buckets:
  - 30 messages / 10 s overall
  - `text.add` 20/min
  - `upload.init` 30/10 min
  - `find` 10/min
  - `signal` 200/min
- Max incoming message: 256 KB.

## 9. Sending files

### 9.1 Direct or upload?

| Situation | Path |
|---|---|
| Room, or busy network | Upload |
| Wi-Fi or Private, exactly one other device here, both `caps.direct`, size ≤ the receiver's `maxDirectBytes` | **Direct** |
| Anything else | Upload |
| Upload impossible (over `MAX_CLOUD_FILE_BYTES`, uploads paused or off) | Direct to each device here (max 4; never on busy networks). Nobody here, or busy → explain (§6.4) |
| Direct fails (not connected within 8 s, stalled 15 s, or declined) | Upload automatically if possible, with a toast |

The sender can tap **Make available for later** on a directly sent item to upload the same file while the tab still holds it.

### 9.2 Direct transfer (WebRTC)

- **Connections:** one `RTCPeerConnection` per pair of peers, created on first need and closed after 2 min idle. One data channel per file (`file-{xferId}`, ordered, reliable).
- **ICE:** `stun:stun.cloudflare.com:3478` and `stun:stun.l.google.com:19302`. TURN only when `TURN_ENABLED` (short-lived credentials from `GET /v1/ice`).
- **Signaling** goes over the space socket (`signal`).
  - Non-trickle: wait for ICE gathering to finish (cap 2.5 s), then send one offer/answer — about 2 messages per connection.
  - Use the "perfect negotiation" pattern; the polite peer is the one with the lower `peerId`.
- **Channel protocol:**
  1. sender → `{"t":"meta","id","name","size","mime","thumb"}`
  2. receiver checks free space (`navigator.storage.estimate()`) and `maxDirectBytes` → `{"t":"accept"}` or `{"t":"decline","reason"}`
  3. sender streams 64 KiB binary frames; pause when `bufferedAmount` > 8 MiB, resume on `bufferedamountlow` (threshold 1 MiB)
  4. receiver writes to OPFS from a dedicated Worker (`createSyncAccessHandle`, batched ~4 MiB writes)
  5. sender → `{"t":"end"}`; receiver verifies the byte count → `{"t":"ok"}`. Either side can send `{"t":"cancel"}` at any time.
- **Receiving:** receivers accept automatically (busy networks never auto-send), show progress, then **Save**.
- **Where direct items live:** they aren't stored on the server and appear only on the two devices.
  - The received file stays in OPFS until it's saved, or for 2 h.
  - Unsaved files survive a reload ("Recovered 2 files — Save").
  - `beforeunload` warns about unsaved files.
- **Size cap:** `maxDirectBytes` = min(free storage − 10 %, platform cap). The platform cap is 1 GiB on iPhone/iPad and none elsewhere.
- **Speed:** show MB/s and time left.

### 9.3 Upload (R2)

- **`upload.init`:** the DO checks size ≤ `MAX_CLOUD_FILE_BYTES`, that the space is alive, and item caps. Then `GuardDO.reserve(ipHash, size, estClassA)`, insert the item (`uploading`), and reply:
  - ≤ 16 MiB: `{id, mode:'single', url, headers}` — a signed PUT valid 1 h. The client must send exactly the returned `headers` (they're part of the signature).
  - Larger: the server calls CreateMultipartUpload (setting Content-Type and Content-Disposition), then replies `{id, mode:'multipart', partSize, partCount, urls:{…first 10}}`.
- **Part size.** R2 requires every part except the last to be the same size, ≥ 5 MiB, with at most 10,000 parts.
  - 16 MiB up to 1 GiB, 32 MiB up to 4 GiB, 64 MiB beyond.
  - Encrypted files use a multiple of the encrypted chunk size (§10).
- **Client upload behavior:**
  - one XHR PUT per part (for progress events);
  - 3 in parallel (2 on phones);
  - retry each part up to 5× with backoff;
  - pause on `offline`, resume on `online`;
  - ask for more URLs (`upload.urls`) when fewer than 3 remain or they're over 50 min old;
  - send `upload.progress` every 10 %.
- **Cancel:** abort the XHRs → `upload.abort` → the server runs AbortMultipartUpload and releases the reservation.
- **Complete:** `upload.complete {parts:[{n, etag}]}` (ETag from each PUT response; bucket CORS must expose it) → CompleteMultipartUpload → status `ready` → broadcast → `GuardDO.commit`.
- **Stored object:**
  - Key: `f/{itemId}`.
  - Content-Type: the file's type if it's on a safe list, otherwise `application/octet-stream` (always for html/svg/xml/js/unknown).
  - Content-Disposition: `attachment; filename*=UTF-8''{name}` (`encrypted.bin` when E2EE).
- **Signing:** done in the DO with aws4fetch, path-style URLs `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}`. Use the S3 API for create/complete/abort; use the R2 binding for deletes and the daily list.
- **Page reload:** loses an in-progress upload (resume-after-refresh is backlog); the alarm aborts it after 2 h.

### 9.4 Download and preview

- **Downloads:** `download.url` returns a signed GET (valid 15 min). Download through a hidden `<a>` pointing at it, so the browser's own download manager does the work with no memory use.
- **Previews:** thumbnails (§9.6). Tapping an image or video opens the signed URL in `<img>` / `<video>`. Never render HTML, SVG or PDF inline.
- **Single-file page** `/f/{ref}`, where `ref = base64url(DO id) + "." + itemId`:
  - Shows name, size, sender, time left, thumbnail, **Download**, **Save to Photos**, **Report**.
  - Uses `GET /v1/files/{ref}` and `POST /v1/files/{ref}/download`.

### 9.5 Saving on the device

- **Uploaded, unencrypted file:** link to the signed URL (above).
- **A stream that needs processing** (decrypt, zip):
  - Chromium desktop: call `showSaveFilePicker()` synchronously in the click handler and stream into it.
  - Elsewhere: write to a temporary OPFS file from a Worker, then download `URL.createObjectURL(file)`.
- **Directly received file:** it's already in OPFS → object-URL download.
- **Save to Photos** (iPhone/iPad; images and videos): `navigator.share({files})` must run inside the tap, with the File already available.
  - Check `navigator.canShare({files})` first.
  - If the file is ready (OPFS file, or already fetched), share at once.
  - Otherwise the first tap fetches it with progress and the button changes to "Tap to save"; the second tap shares.
  - Android and desktop use a normal download.

### 9.6 Thumbnails

- The sender makes them:
  - Images: `createImageBitmap` → canvas, 256 px long edge → WebP (JPEG fallback), quality ~0.6, ≤ 24 KB (retry smaller if needed).
  - Videos: a frame at 0.1 s (best effort, 3 s timeout).
  - Undecodable files (e.g. HEIC outside Safari) get a type icon.
- Thumbnails are stored inline on the item and sent with `state`, so they cost zero R2 operations. They're encrypted in Private Share.

### 9.7 Delete after first download

- The first successful `download.url` sets `consumed_at`. From then on:
  - the item disappears for everyone;
  - no more URLs are issued;
  - the R2 object is deleted after a 1-hour grace period, so the running download can finish.
- The uploader's own device never consumes it.
- A full-size preview counts as a download, so these items show only the thumbnail and **Download**.

### 9.8 Download all

For 2+ downloadable items, build a ZIP in the browser with `client-zip` (no compression) and save it through §9.5. Directly sent items and one-download items are skipped, with a note.

## 10. End-to-end encryption (Private Share)

- **Space key `K`:** 32 random bytes in the URL fragment `#k=` (base64url).
  - Fragments are never sent to servers, and `Referrer-Policy: no-referrer` is set everywhere.
  - Keys are never written to storage.
- **Per-item keys** (HKDF-SHA256):
  - `itemRoot = HKDF(K, salt = itemId, info = "dz1 item")`
  - `contentKey = HKDF(itemRoot, info = "content")`
  - `metaKey = HKDF(itemRoot, info = "meta")`
  - Single-file links from Private Share are `/f/{ref}#k={itemRoot}`, so sharing one file never reveals `K`.
- **File content:** 1 MiB plaintext chunks.
  - Chunk *i* → AES-256-GCM with nonce = 8 zero bytes ‖ uint32-BE(*i*) and AAD = `"dz1|" + itemId + "|" + i + "|" + (last ? 1 : 0)`. This stops reordering and truncation.
  - Each encrypted chunk is 16 bytes longer; a 0-byte file is one empty chunk.
  - `size` in `upload.init` is the plaintext size; stored size = size + 16 × chunk count.
  - Upload parts are a multiple of (1 MiB + 16).
- **Name, type and thumbnail:** AES-GCM with `metaKey` and a random 12-byte IV, stored as base64(iv‖ct) in `encMeta` / `thumb`.
- **Text:** AES-GCM with `HKDF(K, salt = itemId, info = "dz1 text")` and a random IV; `body` = base64(iv‖ct). Plaintext max 50,000 chars.
- **Direct transfers** in Private Share are already encrypted by WebRTC, so no extra layer.
- **What the server sees:** only sizes, times and counts.
- **iPhone/iPad limit:** decrypting a file larger than their cap (1 GiB) isn't supported there → the §6.4 message.

## 11. Text

- **Input:** trimmed; 1–50,000 characters.
- **Rendering:** text nodes only, never `innerHTML`. Linkify http/https only, with `linkify-it`; links open in a new tab with `rel="noopener noreferrer nofollow ugc"`.
- **Copy:** Clipboard API with a fallback. Verify on iOS Safari and Android Chrome.
- **QR:** for texts ≤ 500 chars. `qrcode` is loaded on demand; error correction M; a generous white quiet zone, also in dark mode.
- **Paste & send:**
  - Use `navigator.clipboard.read()`: an image is sent as a file, text is shared.
  - Otherwise fall back to `readText()`.
  - If denied or unsupported, focus the textarea and show "Press Ctrl+V (⌘V on Mac) to paste".
- **Copy latest:** copies the newest text item.
- **Shortcuts:**
  - Ctrl/⌘+Enter shares.
  - Ctrl/⌘+V outside inputs uploads pasted files and puts pasted text in the textarea (not auto-sent).
  - Esc closes dialogs.
  - Don't bind Ctrl+Shift+V — browsers use it for paste-as-plain-text.

## 12. Data model

**SpaceDO** (one per space; SQLite; no secondary indexes):

```sql
CREATE TABLE IF NOT EXISTS space (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kind TEXT NOT NULL,                          -- 'net' | 'ses' | 'room'
  created_at INTEGER NOT NULL,
  expires_at INTEGER, max_expires_at INTEGER,  -- ses / room
  room_code TEXT, locked INTEGER NOT NULL DEFAULT 0,
  busy_until INTEGER                           -- net
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,                         -- 128-bit random, base64url (22 chars)
  type TEXT NOT NULL,                          -- 'text' | 'file'
  cid TEXT NOT NULL,                           -- client id (dedupe)
  code TEXT,                                   -- 4-char search code (net)
  device TEXT NOT NULL, device_name TEXT NOT NULL, device_type TEXT NOT NULL,
  ip_hash TEXT NOT NULL,                       -- for abuse blocking only
  delete_hash TEXT,                            -- SHA-256(deleteToken), net only
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  body TEXT,                                   -- text
  name TEXT, mime TEXT, size INTEGER, enc_meta TEXT, thumb TEXT,
  e2ee INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT, upload_id TEXT, part_size INTEGER,
  status TEXT, burn INTEGER NOT NULL DEFAULT 0, consumed_at INTEGER
);
```

**DirectoryDO**
- Table: `codes(code TEXT PRIMARY KEY, kind TEXT, target TEXT, expires_at INTEGER, locked INTEGER, single_use INTEGER)`.
- Expired rows are purged lazily.
- Throttle counters live in memory (fine if they reset).

**GuardDO**
- Tables: `storage(id = 1, stored_bytes, reserved_bytes)`, `usage(day PRIMARY KEY, class_a, class_b, upload_bytes)`, `blocks(ip_hash PRIMARY KEY, until)`.
- Per-IP daily upload bytes live in memory (lenient if they reset).
- A daily alarm recomputes `stored_bytes` from an R2 list and purges old `usage` / `blocks` rows.

**AdminDO**
- Tables: `reports(id, ref, item_id, reason, note, reporter_ip_hash, created_at, status)` and `feedback(id, type, message, email, created_at)`.

**Names:** `net:{networkId}`, `ses:{token}`, `room:{token}`; singletons `directory`, `guard`, `admin`.

## 13. HTTP API (Worker)

Responses are JSON: `{ ok: true, data } | { ok: false, error }`. CORS allows only `SITE_ORIGIN` (+ `EXTRA_ORIGINS`). Everything after page load happens over the socket; HTTP is only for these:

| Method | Path | Purpose | Limit |
|---|---|---|---|
| GET | `/v1/ws` | WebSocket upgrade (§8) | RL_CONNECT |
| POST | `/v1/sessions` | Create a Private Share → `{token, expiresAt}` | RL_CREATE |
| POST | `/v1/rooms` | Create a room → `{token, code, expiresAt}` | RL_CREATE |
| POST | `/v1/join` | `{code}` → `{kind:'room', token}` or `{kind:'pass', pass}` | RL_JOIN |
| GET | `/v1/files/:ref` | Single-file metadata | RL_PUBLIC |
| POST | `/v1/files/:ref/download` | Signed URL (consumes one-download items) | RL_PUBLIC |
| POST | `/v1/report` | `{ref, reason, note?}` | RL_PUBLIC |
| POST | `/v1/feedback` | `{type: 'feature' \| 'contact', message, email?, website}` — `website` is a honeypot | RL_PUBLIC |
| GET | `/v1/ice` | TURN credentials (only when enabled) | RL_CONNECT |
| GET | `/v1/health` | Status + which features are on | — |
| * | `/v1/admin/*` | `Authorization: Bearer ADMIN_TOKEN`: today's usage, reports, feedback, delete item, block an IP hash (24 h / 7 d) | — |

## 14. Security, privacy and abuse

### 14.1 Secrets and identifiers
- Use crypto randomness only.
- Session/room tokens are 256-bit; item ids are 128-bit; codes use rejection sampling.
- Use constant-time comparison for `ADMIN_TOKEN` and pass signatures.
- IPs are HMAC'd with `IP_HASH_SECRET` and never stored raw. Rotating the secret just resets networks.

### 14.2 Input handling
- zod on every HTTP body and socket message: unknown fields rejected, sizes capped.
- Names: strip control and bidi characters (U+200E/F, U+202A–202E, U+2066–2069); max 255 chars; show the extension separately.
- Stored files get a Content-Type from a safe list, and downloads are always `attachment`.

### 14.3 Rate limits
- Workers Rate Limiting binding, keyed by IP hash:
  - RL_CONNECT 30/min
  - RL_CREATE 10/min
  - RL_JOIN 10/min
  - RL_PUBLIC 60/min
- Per-socket buckets (§8.5).
- GuardDO: 3 GiB uploaded per IP hash per day.

### 14.4 Cost guard (GuardDO)
- **Stored bytes:** tracked through reserve → commit → release.
- **R2 operations per UTC day (estimated):**
  - Class A: 1 per single PUT; parts + 2 per multipart upload.
  - Class B: 1 per download URL.
- **Defaults:** `MAX_STORED_BYTES` 8 GiB · `CLASS_A_DAILY_BUDGET` 30,000 · `CLASS_B_DAILY_BUDGET` 300,000.
- **At any budget:** return `uploads_paused` until the next UTC day, and spaces broadcast `uploads: 'paused'`.

### 14.5 Headers
- **Vercel** (§16.3): CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Permissions-Policy, HSTS.
- **App shells:** `noindex`.
- **Worker:** the same headers (minus CSP), plus CORS.
- If your Astro version supports built-in CSP hashing, use it instead of `'unsafe-inline'` for scripts.

### 14.6 Storage on the device
- No cookies.
- `localStorage`: theme, deviceId, device name, delete tokens.
- `sessionStorage`: Wi-Fi pass, text drafts.
- OPFS: received and decrypted files, cleaned after 2 h.

### 14.7 Abuse
- **Report** button on other people's items and on `/f`.
- **`/admin`** (noindex, unlinked; the token is kept in memory only): today's usage, reports, feedback. Actions: delete an item, or block the uploader's IP hash for 24 h or 7 days.
- **Terms page:** prohibited content plus a takedown contact.
- Busy-network mode keeps strangers' files off your screen on public Wi-Fi.
- Logs never contain tokens, passes, codes, keys, IPs or file names.

## 15. Content and SEO (static, near-zero JS)

- **How it works:**
  - 3 steps: open on both devices → add files or text → they appear on the other device.
  - A short "Direct vs uploaded" explainer.
  - The guides list.
  - FAQ in `<details>` + FAQPage JSON-LD.
- **Guides** (MDX, 600–1,000 words each, original writing):
  - send files from phone to PC without a cable
  - iPhone photos to a Windows PC
  - AirDrop alternative for Android and Windows
  - a Snapdrop / PairDrop / LocalSend alternative that works across networks
  - share text and links between phone and computer
  - free file sharing with no sign-up
- **The FAQ covers:**
  - what it is, and whether it's free
  - direct vs uploaded
  - size limits — direct: no fixed limit (depends on free space on the receiving device); uploads: up to 2 GB
  - how long things last in each mode
  - encryption in each mode
  - busy networks
  - no account
  - what's stored and when it's deleted
- **Other pages:** **About** (your own team), **Contact** (form → `/v1/feedback`), **Privacy** (what's stored and for how long; processors: Cloudflare, Vercel), **Terms**.
- **Metadata:** per-page title, description and canonical; OG/Twitter images as static PNGs; JSON-LD `WebApplication`, `Organization`, `Article` (guides), `FAQPage`.
- **Crawling:**
  - `@astrojs/sitemap`, excluding app shells.
  - `robots.txt` disallows `/s/ /r/ /f/ /j/ /join /private /room/ /admin`.
  - `<meta name="robots" content="noindex">` on those pages.
- **Home screen:** `manifest.webmanifest` + icons, so the site can be added to the home screen.

## 16. Setup

### 16.1 Accounts (write these into SETUP.md with exact clicks and commands)

1. **Cloudflare** (free; no card needed for Workers and Durable Objects): create an account → `npx wrangler login`.
2. **R2** (optional but recommended). Activating R2 asks for a card or PayPal; usage inside the free tier isn't charged.
   - Create bucket `dropzy-files`.
   - Create an R2 API token with Object Read & Write on that bucket only.
   - Set the CORS and lifecycle rules (§16.4).
   - Set a billing notification.
   - No card → set `STORAGE_ENABLED=false` (direct-only mode).
3. **Vercel** (Hobby; free; non-commercial): import the repo, root directory `apps/web`, framework Astro. Env vars: `PUBLIC_API_URL`, `PUBLIC_SITE_URL`.
4. **Secrets:** `wrangler secret put` for each secret in §16.5.

### 16.2 `apps/api/wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dropzy-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",            // use the date you create the project
  "durable_objects": {
    "bindings": [
      { "name": "SPACE", "class_name": "SpaceDO" },
      { "name": "DIRECTORY", "class_name": "DirectoryDO" },
      { "name": "GUARD", "class_name": "GuardDO" },
      { "name": "ADMIN", "class_name": "AdminDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["SpaceDO", "DirectoryDO", "GuardDO", "AdminDO"] }
  ],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "dropzy-files" }],
  "ratelimits": [
    { "name": "RL_CONNECT", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } },
    { "name": "RL_CREATE",  "namespace_id": "1002", "simple": { "limit": 10, "period": 60 } },
    { "name": "RL_JOIN",    "namespace_id": "1003", "simple": { "limit": 10, "period": 60 } },
    { "name": "RL_PUBLIC",  "namespace_id": "1004", "simple": { "limit": 60, "period": 60 } }
  ],
  "vars": {
    "SITE_ORIGIN": "https://dropzy.app",
    "EXTRA_ORIGINS": "http://localhost:4321",
    "STORAGE_ENABLED": "true",
    "TURN_ENABLED": "false",
    "R2_ACCOUNT_ID": "<your account id>",
    "R2_BUCKET": "dropzy-files",
    "MAX_CLOUD_FILE_BYTES": "2147483648",
    "MAX_STORED_BYTES": "8589934592",
    "PER_IP_DAILY_UPLOAD_BYTES": "3221225472",
    "CLASS_A_DAILY_BUDGET": "30000",
    "CLASS_B_DAILY_BUDGET": "300000",
    "BUSY_NETWORK_DEVICES": "7"
  }
}
```

### 16.3 `apps/web/vercel.json`

```json
{
  "rewrites": [
    { "source": "/s/:token", "destination": "/s/index.html" },
    { "source": "/r/:token", "destination": "/r/index.html" },
    { "source": "/f/:ref",   "destination": "/f/index.html" },
    { "source": "/j/:code",  "destination": "/join/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<ACCOUNT_ID>.r2.cloudflarestorage.com; media-src 'self' blob: https://<ACCOUNT_ID>.r2.cloudflarestorage.com; connect-src 'self' https://<API_HOST> wss://<API_HOST> https://<ACCOUNT_ID>.r2.cloudflarestorage.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'" },
        { "key": "Referrer-Policy", "value": "no-referrer" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" }
      ]
    },
    { "source": "/_astro/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] }
  ]
}
```

On a preview deployment, verify:

- `/s/abc` serves the static shell with no Function invoked;
- the shell reads the token from `location.pathname`.

Navigation *into* share pages always uses a full page load (`location.assign`).

### 16.4 R2 bucket settings

CORS:

```json
[{
  "AllowedOrigins": ["https://dropzy.app", "http://localhost:4321"],
  "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["content-type", "content-disposition", "range"],
  "ExposeHeaders": ["ETag", "Content-Length", "Content-Range"],
  "MaxAgeSeconds": 3600
}]
```

Lifecycle rules:

- delete objects 2 days after upload;
- abort incomplete multipart uploads after 1 day.

### 16.5 Environment

| Name | Where | Notes |
|---|---|---|
| `IP_HASH_SECRET` | Worker secret | 32+ random bytes |
| `PASS_SECRET` | Worker secret | 32+ random bytes |
| `ADMIN_TOKEN` | Worker secret | 32+ random bytes |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Worker secrets | R2 API token (Object Read & Write, one bucket) |
| `TURN_KEY_ID`, `TURN_API_TOKEN` | Worker secrets | Only if `TURN_ENABLED` |
| vars in §16.2 | `wrangler.jsonc` | Limits and switches |
| `PUBLIC_API_URL`, `PUBLIC_SITE_URL` | Vercel env | e.g. `https://dropzy-api.<you>.workers.dev`, `https://dropzy.app` |

## 17. Build phases

Stop after each phase, list what to test (on real devices where it matters), and wait.

1. **Scaffold.**
   - Monorepo; Astro site with layout, header, bottom nav, footer, theme (no flash), top bar and feature-dialog UI.
   - Every route as a placeholder; `strings/en.ts`; `vercel.json`.
   - Worker with `/v1/health`; CI (typecheck, lint, unit tests).
   - *Done when:* it's deployed on Vercel, `wrangler dev` answers, and a first visit to `/` makes ≤ 5 requests.
2. **Realtime spine + text.**
   - SpaceDO with hibernation; socket protocol (hello/state/acks/reconnect/heartbeat).
   - Device names and the Devices bar; Wi-Fi detection.
   - Private/Room create + join (DirectoryDO); Extend, Lock, expiry alarms, ended states.
   - Text: add, delete, copy, links, Undo. Tab badge.
   - Connect card for Private/Room.
   - *Done when:* two browsers share text instantly in all three modes; joining by code and link works; lock, extend and expiry work.
3. **Uploads.**
   - R2 + GuardDO (reserve/commit/release, budgets, daily reconcile).
   - Single and multipart uploads with progress, retry, offline resume and cancel.
   - Thumbnails, download, delete; `/f` page and links; search codes.
   - Delete-after-first-download, download all, risky-file warning.
   - `STORAGE_ENABLED=false` mode.
   - *Done when:* a 2 GB file survives a failed part and 30 s offline and downloads byte-identical, and budgets pause uploads with the right message.
4. **Direct transfer.**
   - Peers, signaling, channel protocol, OPFS receiver, Save, recovered files.
   - Decision table + automatic fallback; Make available for later.
   - Speed/time left; iPhone cap.
   - *Done when:* a 1 GB same-Wi-Fi transfer goes direct with zero R2 operations, and a forced failure falls back to upload by itself.
5. **Wi-Fi resilience.**
   - Pass + pair code; the Connect card appears automatically; Leave.
   - Busy-network mode + find by code.
   - *Done when:* an IP mismatch (simulate it in dev) pairs by QR or code, and 7+ devices trigger busy mode.
6. **End-to-end encryption.**
   - Keys and HKDF.
   - Chunked encrypted upload and decrypting download through the sinks.
   - Encrypted text, metadata and thumbnails.
   - `/f` links with their own key; the missing-key state.
   - *Done when:* inspecting SQLite and R2 shows no names, types or content, and every Private flow still works.
7. **Friendly polish.**
   - Save to Photos, text QR, Paste & send, Copy latest.
   - All the §6.4 wording.
   - Empty, loading, error, offline and capacity states.
   - Accessibility pass; mobile polish.
8. **Safety & ops.**
   - Rate limits, reporting.
   - AdminDO + `/admin`.
   - Headers/CSP, log hygiene, validation tests.
9. **Content & SEO.**
   - How it works, 6 guides, FAQ + JSON-LD.
   - About, contact, privacy, terms.
   - Metadata, OG images, sitemap/robots, manifest.
10. **QA & budget check.**
    - Playwright with two browser contexts per mode (text, upload, direct).
    - Join, lock and extend; expiry with a fake clock; busy mode; E2EE inspection.
    - 360 px viewport; dark mode.
    - Request counting against §4.4; Lighthouse.
    - A manual checklist for iPhone Safari, Android Chrome, Windows Edge/Chrome and Mac Safari.

## 18. Backlog and out of scope

**Backlog** — specified, but not built until asked:

- Android share target (installable app; "Share → Dropzy" from the gallery). iOS Safari doesn't support share targets.
- Folder upload (desktop `webkitdirectory`, zipped on the fly).
- Resume uploads after a page refresh (IndexedDB state + re-pick the file).
- Previews for PDF, audio and code.
- Send to one specific device (tap a device to send directly).
- Urdu and other languages (strings are already centralized; add RTL).
- Browser notifications and sounds.
- TURN relay (config exists, off by default).

**Out of scope** — don't build:

- accounts or paid tiers
- passwords on shares
- short human-readable links
- local share history
- image compression
- custom expiry pickers or multi-day retention
- malware scanning
- analytics SDKs
- cookies

## 19. Acceptance criteria

**Core flows**

- Two devices on the same Wi-Fi open `/`: each sees the other in "Devices here" within 2 s, and text appears on the other within 1 s.
- Same Wi-Fi, 1 GB file: it goes direct ("Sent directly") with zero R2 operations and a visible speed, and the receiver saves it intact.
- Direct connection impossible (forced): the upload starts automatically with the toast and completes.
- A 2 GB upload survives one failed part and 30 s offline, and the download's SHA-256 matches.
- IP mismatch (simulated): the Connect card appears, and the QR or pair code joins the same space.
- 7+ devices on one network: busy mode turns on, others' items are hidden, and find by code works.

**Private, rooms and special items**

- Private Share: SQLite and R2 contain no plaintext names, types, texts or file contents. A `/f` link with its key works; without the key it shows the friendly message.
- Room: joins work by code, link and QR; lock blocks new joins; Extend works up to the cap. At expiry, rows and R2 objects are gone within minutes.
- One-download file: a second attempt says it's no longer available.
- Save to Photos works on iOS Safari for a photo and a video.

**Performance and privacy**

- The budgets in §4.4 hold in Playwright request counts.
- Lighthouse performance: content pages ≥ 95, `/` ≥ 90. axe finds no serious issues.
- No cookies; no raw IPs stored; no tokens, keys or codes in logs.

**Compatibility and states**

- Works in current Chrome, Edge, Firefox, Safari (macOS and iOS) and Samsung Internet. Layout is correct at 360 px, with dark mode everywhere.
- Every degraded state shows its message: uploads off, uploads paused, at capacity, offline, ended, wrong code, locked, missing key.

## 20. Sources checked (September 2026)

- Vercel Hobby plan — https://vercel.com/docs/plans/hobby
- Vercel WebSockets — https://vercel.com/docs/functions/websockets
- Workers limits — https://developers.cloudflare.com/workers/platform/limits/
- Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- Durable Objects pricing — https://developers.cloudflare.com/durable-objects/platform/pricing/
- R2 pricing — https://developers.cloudflare.com/r2/pricing/
- R2 multipart uploads — https://developers.cloudflare.com/r2/objects/multipart-objects/
- Workers Rate Limiting — https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- Cloudflare TURN/STUN — https://developers.cloudflare.com/realtime/turn/faq/
