# QA checklist

Automated: `pnpm lint && pnpm typecheck && pnpm test` (unit + Worker integration) and `pnpm --filter @dropzy/web e2e`
(Playwright, starts `wrangler dev` and `astro dev` itself). Uploads need real R2, so run the upload items below on a
preview deployment.

## Real devices

Test on **iPhone Safari**, **Android Chrome**, **Windows Edge/Chrome**, **Mac Safari** (plus Firefox and Samsung Internet where noted).

### Wi-Fi Share
- [ ] Two devices on the same Wi-Fi open `/`: each shows the other in "Devices here" within 2 s; text appears on the other within 1 s.
- [ ] 1 GB file between them: "Sending directly" with a speed, "Sent directly to …", receiver saves it intact. R2 dashboard shows no new operations.
- [ ] Phone on mobile data (or VPN): the "Waiting for your other device…" card appears after ~8 s; scanning its QR joins; entering the pair code on `/join` joins; "Connected by code · Leave" works.
- [ ] Reload the receiving tab before saving: "Recovered 1 file — Save"; closing the tab first warns about unsaved files.

### Private Share
- [ ] `/private` → link + QR; open on another network; text and files both ways; lock icon shows.
- [ ] Copy a file's link → open on a third device: downloads and decrypts. Remove `#k=…`: the missing-part message shows.
- [ ] Extend twice → "Maximum length reached".

### Rooms
- [ ] Join by code, by `/j/{code}` link, and by QR. Lock → new joins say "This room is locked"; people inside stay.

### Uploads (needs R2)
- [ ] 2 GB upload: kill the network for 30 s mid-upload ("You're offline…"), it resumes and finishes; SHA-256 of the download matches.
- [ ] "Delete after 1 download": second attempt says it's no longer available; the uploader's own downloads don't count.
- [ ] Download all → one ZIP (skips one-download items with a note).
- [ ] Budgets: set `CLASS_A_DAILY_BUDGET` low → "Uploads are paused for today…"; direct transfer still works.
- [ ] `STORAGE_ENABLED=false`: nobody here → "Open Dropzy on the other device first…".

### iPhone / iPad
- [ ] Save to Photos for a photo and a video (uploaded and directly received).
- [ ] Copy (text) and Paste & send work in Safari; Android Chrome too.

### Everywhere
- [ ] Layout correct at 360 px, dark mode everywhere, keyboard-only use, VoiceOver/TalkBack announce new items.
- [ ] No cookies (DevTools → Application → Cookies is empty).
- [ ] Lighthouse: content pages ≥ 95, `/` ≥ 90. First visit to `/` stays within ~5–6 requests to the site.
