# MIOLOVE ALBUM — go-live sprint (audit + report)

Audit date: 2026-10-19/20. Everything below was verified in the code and with the emulator test suites; nothing was deployed, committed or pushed.

## 1. Feature audit

A = exists and works · B = partial · C = does not exist.

| Feature | Class | Evidence / what is missing |
|---|---|---|
| Google login | **A** (new) | `signInWithGoogle` (popup) on MIOLOVE `/login` + `/register`; same uid, profile created only if the uid has none (`initAccountProfile`). Needs the **Google provider enabled in the Firebase console** and the miolovealbum.com domain in *Authorized domains* (cannot be checked from the repo). IOMIXO login untouched. |
| Photo upload / album / gallery | A | `createPhotoUpload` → Storage → `finalizePhoto`. |
| **Video** | **C** | Uploads accept `jpg/png/webp` only (functions `MIME_BY_EXT`, `storage.rules`, booth/gallery UI). The admin only *detects* video URLs. **VIDEO FEATURE MISSING.** A real implementation needs: guest upload (mp4/mov/webm), size limits, Storage rules, finalize, trial quota, gallery player, TV/slideshow playback, delete, progress, mobile (iOS) capture. Not improvised. |
| Unlimited media (paid) | B | No quota on `activated` albums (photos only); anti-spam cap of 60 uploads per guest per event. |
| Original quality | **C** | The browser resizes to 1920 px / JPEG 82 % before upload (`compressImage`), hard cap 8 MB (functions + `storage.rules`). |
| Trial quota 50 | A | `trialPhotoCount/Limit`, transactional in `finalizePhoto`. Counts photos only. |
| **Trial 7 days** | **A** (new, server-side) | `createEvent` writes `trialStartsAt` / `trialExpiresAt` (server clock, +7 d). After the end: new uploads refused (`miolove_trial_expired`) in `createPhotoUpload` and `finalizePhoto`; nothing is deleted; the owner reads the album and sees *Attiva album*; guests keep seeing the page with a notice. **Albums created before this change carry no end date and never expire** (no retroactive lock-out). |
| **Retention 365 days** | **A** | Implemented per album (§7): `activatedAt` / `expiresAt`, daily purge. |
| **Download all in one click** | **C** (B for the old button) | The existing "Scarica tutto" fires one browser download per file (≤ 250 ms apart); no ZIP, no server export. Now locked on trial. A client-side ZIP needs CORS on the Storage bucket (unverifiable here). Proper fix: server-side export (Function → ZIP in Storage → signed URL). |
| **White label** | **A** (new, dormant) | An `activated` album shows no MIOLOVE mark on the guest page, Live Booth and TV screen (and tab title). Trial keeps it. Dormant until paid activation exists. |
| Poster / QR card gating | **A** (new) | Editor only when `access_mode === 'activated'`; trial sees a locked card. **Client-side gate only**: the poster is rendered in the browser, there is no server asset to protect. |
| Slideshow / monitor | A (was B) | `/screen/[slug]` existed but was blocked for MIOLOVE albums by IOMIXO plan limits (`features.screenMode`) and photos were off by default. Both fixed. |
| Paid activation (checkout) | **C** | No MIOLOVE price / product / webhook path (see §2). |

## 2. Stripe — report of the CURRENT configuration (nothing changed)

Source: `firebase/functions/.env.iomixo-494817`, `functions/src/billing/prices.ts`, `frontend/lib/pricing.ts`. No call to the Stripe API was made.

| Env var | Product | Mode | Scope |
|---|---|---|---|
| `STRIPE_PRICE_PRO_EUR/USD` | Pro (€9.99/month) | subscription | iomixo |
| `STRIPE_PRICE_ADVANCE_EUR/USD` | Advance (€19.99/month) | subscription | iomixo |
| `STRIPE_PRICE_EVENT_PASS_EUR/USD` | Event Pass 24H (€7.99) | one-time payment | iomixo |
| `STRIPE_PRICE_LEGACY_PRO/ADVANCE` | old prices still on live subscriptions | webhook only | iomixo |

* `buildPriceTable` hard-codes `scope: 'iomixo'` for every price. **There is no MIOLOVE price.** The €19.99 "Album completo" does not exist in Stripe nor in the table.
* The only paths that can mark an album `activated` today are an IOMIXO-unrelated `miolovePlan` (subscription, scope miolove – no price maps to it) or a miolove-scope Event Pass: both unreachable.
* **Proposed change (needs your OK, it touches billing):** new price `STRIPE_PRICE_MIOLOVE_ALBUM_EUR` (one-time €19.99) in the table with `product: 'album'`, `scope: 'miolove'`, `mode: 'payment'`, `checkout: true`; checkout takes an `eventId` owned by the caller; the webhook on `checkout.session.completed` sets on that event `accessMode: 'activated'`, `activatedAt`, `expiresAt = activatedAt + 12 months`, idempotent by payment id; unknown prices keep failing loudly; tests with the Stripe stub. The MIOLOVE billing page already has the *Attiva album* slot, currently disabled with an honest note.

## 3. Proposed structure for activation / retention (not implemented, needs approval)

* Fields on `events/{id}`: `activatedAt`, `activatedBy` (payment id), `expiresAt` (= +12 months).
* Policy to approve: upload/download window = 12 months from `activatedAt`; after `expiresAt` the album becomes read-only for the owner, guests cannot upload; **no automatic deletion** until a written policy (grace period, reminder e-mails at 30/7 days, export offered) is approved; deletion, if any, is a separate explicit maintenance job.
* Trial after expiry (implemented): readable by the owner, media kept, uploads closed, CTA *Attiva album*. Retention of expired-trial media is **undefined** and needs the same decision.

## 4. Root causes found

* **"L'esperienza interattiva sarà disponibile tra poco" on a QR scan.** Not the date (no code reads it). `getPublicEvent` returned the *owner's IOMIXO plan* features: a trial album's owner is "free" → `guestPhotoAlbum: false` → the guest menu filtered the only action out → empty-state text. Same cause blocked the TV (`screenMode: false`). Fixed server-side (`publicEvent.ts`: MIOLOVE albums are decided by `hasMiolovePhotoAccess`), plus the page defaults a missing `guest_config` to the album defaults. Real tests with a 2031 date.
* **"WEDDING EDITION" on a birthday.** The guest hero used a hard-coded default eyebrow; MIOLOVE now passes the occasion.
* **"Nomi degli sposi" on a birthday.** Hard-coded label; now `occasion.<type>.namesLabel`.
* **Privacy locked with Event Pass / Advance.** The panel used the IOMIXO entitlement and excluded `trial`. MIOLOVE albums never hit the gate.
* **Monitor preview missing.** Only rendered for DJ events. Dashboard previews are now the real `/live` and `/screen` pages in same-origin frames (`X-Frame-Options: SAMEORIGIN` only on those two routes).

## 5. Blockers / still to build

1. **B1 – Stripe product + checkout + webhook for the €19.99 album** (§2). Without it nobody can activate: the public price is shown but cannot be bought.
2. Google provider + authorized domains in the Firebase console (manual).
3. Retention: implemented, see §7. Video, original quality and download-all are implemented, see §6.
4. Real reviews: the home hides the section in production (`lib/miolove/reviews.ts`); demo layout shows only in development / `NEXT_PUBLIC_MIOLOVE_SHOW_DEMO_REVIEWS=true`.
5. Trial-expired media policy (§3).
6. `www`/apex DNS + `NEXT_PUBLIC_MIOLOVE_LIVE=true` when miolovealbum.com answers.

## 6. Media engine (photos + videos, originals, download-all) — implemented, awaiting review

**Model** (`firebase/functions/src/photos/media.ts`). Per media, under `events/{e}/photos/{p}/`:
`original.{jpg|png|webp|mp4|mov|webm}` = EXACTLY what the guest sent (never transcoded, never replaced; the only file the owner downloads) ·
`optimized.jpg` (photos: 1920 px, what gallery / TV show) · `thumb.jpg` (photo thumbnail, or the poster frame of a video). Doc fields (absent on legacy photos,
which are read as one compressed photo and keep working): `mediaType, originalPath, optimizedPath, thumbPath, originalFilename, size (original), maxBytes, width, height, durationSec`.

**Limits.** Technical per-file limits only: video 150 MB (`MEDIA_LIMITS.videoBytes`, 150 MiB), original photo 50 MB, legacy single-file photo 8 MB.
No limit on the NUMBER of photos/videos of an activated album. Per-guest anti-abuse cap on a MIOLOVE album: 500 uploads (cooldown 500 ms); IOMIXO events keep 60 / 2 s.
**Trial = 50 CONTENTS TOTAL** (photos + videos share the counter `trialPhotoCount`, taken in the `finalizePhoto` transaction, freed by delete, never taken by a failed upload).

**Security.** `storage.rules`: a guest may create only the object(s) written in the photo doc created by `createPhotoUpload` (exact path, own uid, declared type, size ≤ `maxBytes`, no overwrite).
Reading: the OWNER reads everything; guests / TV read only APPROVED media and only what they need to show it: optimized image, thumbnail, the video file itself (no transcoded copy
exists, so a video's file must be readable to be played), and the single file of a legacy photo. The ORIGINAL of a new photo is NOT readable by guests. No listing for anyone. The
export path is closed to every client; export docs are readable by the owner only.

**Download everything** = server-side, streamed (never in the browser's memory): `requestAlbumExport` (owner, paid album only) → Firestore trigger `onAlbumExportCreated` streams every
original (approved + pending; not rejected / unfinished) through a store-only ZIP into `events/{e}/exports/{x}/album.zip`, updating `processed` → `getAlbumExportUrl` gives the owner a fresh
tokenised URL → one download (`album.zip`). Archives expire after 24 h; `purgeAlbumExports` (scheduled, hourly) and every new request delete the expired ones. Trigger: 1 GiB, 540 s.

**TV / slideshow.** A video plays once, MUTED (browsers refuse autoplay with sound and a TV has nobody to unmute; the original with sound stays downloadable), then the slideshow moves on
(ended / error / 15 s without progress / 120 s cap — never an endless loop). A lone video restarts. Grid wall: videos take part as poster frames. IOMIXO events never contain videos.

**Not done / known limits (deliberate, to be decided):**
- No server transcoding: a video the guest's / owner's browser cannot decode (e.g. HEVC `.mov` outside Safari) is stored intact and downloadable, shown with a "download the original" message in the player (no poster if the uploader's browser could not decode it either).
- HEIC / GIF / AVI are refused with a clear message (iOS normally converts HEIC to JPEG in the picker when `accept` lists JPEG/PNG/WebP — NOT verified on a real iPhone / Android in this sprint, only in headless Chrome).
- Failed uploads leave an `uploading` doc + partial files (never counted, never shown); there is no sweeper for them yet.
- Deploy prerequisites to verify BEFORE going live: the Functions service account needs Storage object read/write/delete (it already deletes objects); Cloud Scheduler enabled for `purgeAlbumExports`;
  the Firestore trigger region must match the Firestore database location; the `archiver` dependency is new in `firebase/functions`.

## 7. Multi-album lifecycle, €19.99 per album, 365 days, automatic deletion

**Model.** There is no account plan. One account owns any number of albums; each album is independent and carries its own state on `events/{eventId}`:

| `accessMode` | meaning | written by |
|---|---|---|
| `trial` | the account's ONE free trial (7 days, 50 contents). `trialAlbums/{uid}` is the one-time reservation (never deleted). | `createEvent` (first album only) |
| `pending` | "Da attivare": created, unpaid. No trial, no uploads, no archive, no poster. | `createEvent` (every later album) |
| `activated` | paid: `activatedAt` = payment instant, `expiresAt` = `activatedAt` + 365 days (server clock), `activation{…}`, `retention{days, reminders{}}` | `mioloveStripeWebhook` ONLY |
| `purged` | content deleted for good; the doc is a hidden administrative tombstone (`purgedAt`, `deletedAt`) | the purge job |

`purgeAfter` (Timestamp) is the single field the scheduler queries: trial → `trialExpiresAt` + 30 d, activated → `expiresAt`. Pure rules: `firebase/functions/src/photos/albumLifecycle.ts`.

**Trial end.** After 7 days the album is paused (no new uploads, media kept). It can still be activated for 30 days; paying inside the window keeps every media and starts the 365 days at payment time. After 30 days without payment the content is deleted. A stale Checkout Session paid after that cannot revive the album (recorded as `blocked:album_not_eligible`, a human refunds from Stripe).

**Purge** (`purgeExpiredMioloveAlbums`, daily 03:30 Europe/Rome, `functions/src/albums/purge.ts`): claim (lease) → delete everything under `events/{id}/` in Storage → recursively delete every subcollection → remove `eventSlugs/{slug}` → replace the doc with the tombstone. Kept: `users/{uid}/payments`, `mioloveStripeEvents`, `trialAlbums/{uid}`, activation proof. Idempotent and resumable (failed step → `purge.state='failed'`, the next run retries). IOMIXO events are never selected (brand re-checked on the doc).

**Before deploy.** (1) Run the one-shot backfill `firebase/functions/scripts/backfill-album-expiry.ts` (dry run by default) so already-activated albums get `expiresAt = activatedAt + 365 d` and existing trial albums get `purgeAfter`; albums without these fields are NEVER purged. (2) The functions service account needs Storage object delete/list on the bucket (it already writes/deletes export archives). (3) Cloud Scheduler must be enabled (same as `purgeAlbumExports`). (4) Email reminders (30 / 7 / 1 days before `expiresAt`) are not built; `retention.reminders` is ready to stamp them.
