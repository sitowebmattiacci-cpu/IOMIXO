# Firebase (migration in progress)

Infrastructure baseline for the Supabase + Render → Firebase migration.
**Nothing is deployed and no app domain is migrated yet.** Supabase, Render and
Stripe are still the live stack.

## Structure

    firebase/
      firebase.json          emulators + functions/rules wiring
      .firebaserc            default project = demo-iomixo (placeholder)
      firestore.rules        deny-all
      storage.rules          deny-all
      firestore.indexes.json empty
      functions/             Cloud Functions 2nd gen, TypeScript, Node 22
        src/index.ts         only `health` (smoke test); region europe-west1, minInstances 0

App-side code:
- Frontend: `mashfusion-ai/frontend/lib/firebase/client.ts` (modular Web SDK, idempotent init, emulator switch)
- Backend: `mashfusion-ai/backend/src/lib/firebaseAdmin.ts` (lazy Admin init, ADC in production)

## Emulators (project `demo-iomixo`, no real Firebase contacted)

    cd firebase && firebase emulators:start --project demo-iomixo

| Service   | Port |
|-----------|------|
| Auth      | 9099 |
| Firestore | 8080 |
| Storage   | 9199 |
| Functions | 5001 (`http://127.0.0.1:5001/demo-iomixo/europe-west1/health`) |
| UI        | 4500 |

Frontend: set `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true`.
Backend: export `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199`.

## Environment variables

Frontend: `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_USE_EMULATORS`, `_EMULATOR_HOST`.
Backend: `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, optional `GOOGLE_APPLICATION_CREDENTIALS` (local only).

## Real project: `iomixo-494817` (linked, nothing deployed)

`.firebaserc`: `default` and `prod` → `iomixo-494817`, `emulator` → `demo-iomixo` (a demo id is not a real project, so
`firebase use emulator` is rejected by the CLI; it is documentation — **emulators and tests always pass `--project demo-iomixo`**,
see `npm run emulators` here and the `test:firebase` scripts). A bare `firebase deploy` now targets production: always add an
explicit `--only`, and never deploy without the checklist below.

Verified read-only on 2026-10-09: Firestore `(default)` Native in europe-west1; Auth: Email/Password, Google, Anonymous enabled;
Storage bucket `iomixo-494817.firebasestorage.app` (europe-west1) matches the web config; deployed Firestore and Storage rules are
deny-all; web app `iomixo-web` config matches. `firebase deploy --only firestore:rules,firestore:indexes,storage --dry-run` compiles.

Frontend env (git-ignored; real values are public web identifiers, never put a service account here):
`NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,STORAGE_BUCKET,MESSAGING_SENDER_ID,APP_ID}`,
`NEXT_PUBLIC_FIREBASE_USE_EMULATORS` (`true` only for `npm run dev:emulators`; `false` in cloud),
`NEXT_PUBLIC_AUTH_PROVIDER` (`supabase` = keep legacy auth even though Firebase is configured; `firebase`/unset = switch).
In emulator mode the client ignores the real values and uses `demo-iomixo`.
Local cloud-config file: `mashfusion-ai/frontend/.env.production.local` (used by `next build`/`next start`).
Hosting dashboards (Vercel/Cloudflare): set the same keys there. **Do not set the Firebase keys in production without
`NEXT_PUBLIC_AUTH_PROVIDER=supabase`** — they would switch every visitor to Firebase Auth while the owner has no Firebase account.

Backend (Render/Cloud Run) env: `FIREBASE_PROJECT_ID=iomixo-494817`, `FIREBASE_STORAGE_BUCKET=iomixo-494817.firebasestorage.app`.
Token verification needs no credentials. Firestore access (projection flag) needs credentials: Application Default Credentials on
Google infrastructure, or a service account supplied as a platform secret (never in git).

## Authentication (STEP 2)

Flow: Next.js → Firebase Auth (`lib/auth` facade → `lib/firebase/auth.ts`) → ID token →
`Authorization: Bearer` (set centrally in `lib/api.ts`) → Express `middleware/auth.ts`
→ `verifyIdToken()` → `req.user = { uid, sub, email, emailVerified, isAnonymous, provider, ... }`.

- **Provider selection:** Firebase is primary whenever it is configured (`NEXT_PUBLIC_FIREBASE_*` or emulators).
  Without Firebase config the legacy Supabase path stays active (current production). Backend: Firebase is tried first, Supabase token is the fallback (`TODO(firebase-migration)`).
- **Roles of middleware:** `requireAuth` = real (non-anonymous) account, anonymous → 403. `requireAnyAuth` = any verified identity incl. anonymous (for future guest/TV/remote routes).
- **Identity is token-only.** Never read uid/email/role/ownerId from body or query.
- **Supabase ID bridge:** existing routes still query Supabase with `req.user.sub`. For a Firebase user `sub` = custom claim `legacyUserId` (server-set via Admin SDK) if present, else the Firebase UID (which has no Supabase row until the data layer moves). Remove when Firestore keyed by UID replaces it.
- **Anonymous:** `ensureAnonymousSession()` in `lib/firebase/auth.ts` reuses an existing session instead of creating a new anonymous user. Not yet wired into guest/TV/remote pages.
- **Email links:** set the custom action URL in the Firebase console (Authentication → Templates) to `https://<app>/auth/action`; it routes `resetPassword` → `/reset-password?oobCode=…` and `verifyEmail`.
- **Protected pages:** `AuthGate` in the dashboard layout redirects signed-out/anonymous users to `/login` (UX only; the backend enforces).

### Local owner account (emulator only)

    export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
    cd mashfusion-ai/backend
    npx ts-node --transpile-only scripts/seed-local-owner.ts owner@iomixo.local password123 [<supabase-user-uuid>]

The script refuses to run without the emulator host. The real account is created later in the real project
(console or Admin SDK), then bridged with `setCustomUserClaims(uid, { legacyUserId: '<supabase uuid>' })`
until the data moves to Firestore. No Supabase password import.

### Tests

    # unit (mocked Admin SDK)
    cd mashfusion-ai/backend && npm test
    # integration against the Auth emulator (start emulators first)
    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx ts-node --transpile-only scripts/auth-emulator-check.ts

## Firestore: users / profile / plan (STEP 3)

Layers: UI → `lib/users/userService.ts` (+ `useUserProfile`) → `lib/firebase/repositories/*` → Firestore.
Backend: `src/repositories/userRepository.ts` (Admin SDK). Models: `lib/firebase/models.ts`. No Firestore calls in components.

**`users/{firebaseUid}`** (owner-read only)

| Field | Writer | Notes |
|---|---|---|
| `uid`, `email` | client at create | must equal the token's uid/email; immutable afterwards |
| `displayName` | client | ≤80 chars |
| `avatarPath`, `avatarUrl` | **server only** (`commitAvatar` / `removeAvatar`) | Storage path + tokenised download URL |
| `plan { tier, source, validUntil? }` | **server only** | tier `free\|pro\|wedding` (wedding = Advance); source `default\|legacy\|stripe`. Client can only create `free/default`. |
| `legacySupabaseId` | **server only** | transitional bridge to Supabase `users.id` (owner/legacy records) |
| `createdAt`, `updatedAt` | server timestamps | enforced `== request.time` by rules |

Entitlements are **derived from `plan.tier`** (`config/plans.ts` → `getEntitlements(uid)`), not stored. Not migrated: `credits_*` (legacy AI engine), `stripe_customer_id` (Stripe step).

**`djProfiles/{firebaseUid}`** (decision: separate collection, not embedded in `users`). Reasons: different audience and
lifecycle (it will become publicly readable by slug for the live page, while `users` holds private billing state);
different write permissions (`publicSlug` is server-only because uniqueness needs a transaction; `plan` must never share a doc
with client-editable fields' rules); and the doc stays small. Fields: `displayName, bio, avatarUrl, instagramUrl, tiktokUrl,
spotifyUrl, soundcloudUrl, websiteUrl` (client), `publicSlug` (server), timestamps. Lookup by slug later needs only an automatic
single-field index, so `firestore.indexes.json` stays empty.

**Rules:** owner-only `get` (non-anonymous), no `list`, no delete. Update limited by `affectedKeys().hasOnly(...)` to the
profile fields. Every other collection remains deny-all.

**Transition rules.** The Firestore `plan` is NOT yet the source of truth: Supabase `users.plan` still drives billing/limits
until the Stripe step writes `plan` from a Cloud Function. The UI (settings/billing) still reads `/user/me`; `useUserProfile`
is ready but not wired, to avoid two diverging sources. `legacyUserId` auth claim and `legacySupabaseId` are removed when all domains are migrated.

### Seed the owner (emulator only)

    cd firebase && firebase emulators:start --project demo-iomixo      # terminal 1
    export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
    cd mashfusion-ai/backend && npx ts-node --transpile-only scripts/seed-local-owner.ts owner@iomixo.local password123 <supabase-uuid> pro

Creates the Auth user (claim `legacyUserId`) and `users/{uid}` with `legacySupabaseId` and the given tier. Refuses to run without emulator hosts.

### Tests

    cd mashfusion-ai/frontend && npm run test:firebase   # rules + repositories via real client SDK + Auth emulator (9 tests)
    cd mashfusion-ai/backend  && npm run test:firebase   # Admin repository (3 tests); `npm test` skips them

## Firestore: events (STEP 4)

**Transition model.** Supabase `live_sessions` is still the source of truth because every child domain (requests, polls,
games, photos, passes) has a foreign key to it, and plan limits / Event Pass checks live in the Express routes. So events
are a **one-way projection Supabase → Firestore** done by the backend (`services/eventProjection.ts`), **never written by
clients**. It is OFF by default (`FIRESTORE_EVENT_PROJECTION=on` to enable), runs only for Firebase-authenticated DJs (it
needs their Firebase UID), is best-effort and logged, and never reads Firestore back into Supabase. Risk: a failed
projection leaves Firestore stale until the next write of that session; the public page then simply keeps the last data (and
falls back to polling if the doc does not exist). A backfill for pre-existing sessions is still a TODO.

**`events/{eventId}`** (auto id; fields only what the product uses today)

| Field | Notes |
|---|---|
| `ownerUid` | Firebase UID of the DJ; set once, never changes (enforced server-side; clients cannot write) |
| `legacySupabaseId` | TRANSITIONAL: `live_sessions.id`, needed by child domains |
| `slug` | random 10+ char public slug generated by the backend (never user-chosen) |
| `title, djName, description, type (standard\|party\|wedding), status (live\|ended)` | `status` = Supabase `is_active`; there is no draft/scheduled/archived concept in the product, so none was invented |
| `coupleNames, weddingDate, venueName, screenModeEnabled, guestConfig` | wedding/guest-visibility settings read by the public page |
| `createdAt, updatedAt` | `createdAt` copied from Supabase, `updatedAt` server timestamp |

Not projected yet (no consumer in this step): `screen_config`, `roulette_penitenze`, `shoe_game_questions`.
`events/{id}/private/{doc}` is reserved and rule-protected (owner `get` only) for owner-only config such as game answers.

**Live state: kept inside the event document (option A) for now.** Everything in it changes a handful of times per event
(DJ edits, open/close), the doc is ~1 KB, so one listener per guest costs almost nothing. Genuinely high-frequency state
(presence/online count, game rounds, poll tallies, requests) must NOT go in this doc: each will have its own
collection/document (e.g. `events/{id}/state/live` for the "current game/poll" pointer) when that domain is migrated.

**Slugs: `eventSlugs/{slug} → { eventId }`** (doc id = slug). Uniqueness is atomic: the event and its slug doc are created in
one batch with `create()`, which fails if the slug exists (`EventConflictError`). A collection query on `events.slug`
would not be transactional and would require listing rights; the mapping lets guests do a single `get`.

**Guest access.** QR/link → `/live/{slug}` → `ensureAnonymousSession()` (reuses any session) → `get eventSlugs/{slug}` →
`get events/{id}` → `onSnapshot` on that single document. Rules: any signed-in user (including anonymous) may `get` an
event/slug (the unguessable id/slug is the capability, as with the public link today); nobody can list events except the
owner querying with `where('ownerUid','==',uid)`; `private/*` is owner-only; **no client may write** `events` or
`eventSlugs`. Caveat: the product has no private/draft events, so "private" = the `private/*` subdocuments and other
owners' listings.

**Realtime.** `useLiveEvent(slug)` (public live page) opens one listener and closes it on unmount/slug change. When it is
active the page's 15 s SWR polling is turned off (`refreshInterval: 0`); the backend payload is still fetched once for
profile/plan/features and merged with the realtime event fields. If Firebase is not configured, the event is missing, or the
listener errors, the page transparently keeps the legacy polling. Still polling (other domains / not event state): presence
heartbeat, requests, polls, games, photos, TV screen, remote, dashboard `getSession` (it also returns the backend-only
`online_count`).

**Index:** `events(ownerUid ASC, createdAt DESC)` for `listOwnerEvents` (the only composite one).

**Repositories:** frontend `lib/firebase/repositories/eventRepository.ts` (read-only: by id, by slug, owner list, subscribe),
service `lib/events/eventService.ts`, hook `lib/events/useLiveEvent.ts`; backend `src/repositories/eventRepository.ts`
(projection, slug transaction). Creation via Cloud Function is deferred until plan/Event Pass state moves to Firestore.

### Tests

    cd mashfusion-ai/frontend && npm run test:firebase   # 19 tests: users, djProfiles, events rules, queries, listener
    cd mashfusion-ai/backend  && npm run test:firebase   # 9 tests: users + events projection (emulator); `npm test` runs mocked ones

**Known emulator log noise.** Denied *updates* whose rule reads `resource`/`request.resource` print
`evaluation error at L<n>:24 for 'update'` followed by `false for 'update'`. Reproduced with trivial rules
(`allow update: if resource.data.uid == 'zzz'`), so it is not a bug in our expressions: the request is denied
either way, and permitted updates evaluate cleanly (covered by the allow/deny tests).

## Firestore: music requests (STEP 5)

**Authority.** Supabase `live_requests` is still the source of truth: the legacy DJ dashboard, remote control and
`my-requests` routes read and moderate it. Direction stays **Supabase → Firestore**; Firestore is never written back.
Two writers produce Firestore request docs: the `createMusicRequest` Cloud Function (guestUid set) and the backend's
projection of the legacy `POST` (guestUid null). Moderation (approve/reject/delete) stays on the Express routes, which
project the change (`status`, delete). Reason: every legacy reader and the plan limit depend on the Supabase row, so making
Firestore authoritative now would need a bidirectional sync = two authorities. Moderation moves to Functions when the
legacy readers are gone.

**`events/{eventId}/requests/{requestId}`** (auto id): `guestUid` (anonymous/account uid, or null for legacy-projected),
`songTitle`, `artist`, `message`, `status` (`pending|approved|rejected` — the only states the product has; no played/upvote),
`legacySupabaseId`, `createdAt`, `updatedAt`. `eventId` is not duplicated (it is in the path); there is no guestName
(the SQL table has none — note: the legacy remote route `GET /:slug/requests` selects a non-existent `guest_name` column, pre-existing).

**Server-only helper docs** (no rules → denied to every client):
`events/{id}/state/requests` = `{ total }` (event-wide counter, also the cheap source for counts) and
`events/{id}/requestGuests/{uid}` = `{ count, lastAt }` (anti-spam).

**Callable `createMusicRequest`** (2nd gen, europe-west1, minInstances 0, CORS restricted; TODO App Check):
1. requires Firebase Auth (anonymous OK) — uid from the token only; only `eventId, songTitle, artist, message` are read from the
   payload (spoofed `guestUid/status/createdAt/ownerUid` are ignored by construction);
2. validates: title 1–200, artist ≤200, message ≤500, strings only, control chars stripped;
3. event must exist, `status == live`, and (non-standard types) `guestConfig.requests !== false`;
4. **one Firestore transaction** reads/updates the counter and the guest doc: cooldown (20 s, same as legacy), max 10
   requests per guest per event (new), event-wide limit → concurrent calls cannot bypass them (tested: 5 simultaneous
   guests with limit 2 → exactly 2; 3 simultaneous calls by one guest → 1);
5. inserts into Supabase through the temporary bridge (`src/requests/legacyBridge.ts`); if that fails the reservation is
   rolled back (guest can retry, cap not consumed) and `unavailable/bridge_failed` is returned;
6. writes the Firestore doc with server timestamps; up to 3 attempts. If only this step fails the request is still saved
   (Supabase) and the call succeeds with `projected:false`.
Errors carry `details.reason`: `unauthenticated, invalid_payload, event_not_found, event_ended, requests_disabled,
event_not_ready, cooldown, guest_limit, event_limit, bridge_failed`.

**Plan limit bridge (temporary).** Plan authority is Supabase. The backend computes the DJ's *effective* plan limit
(`maxRequestsPerSession`, incl. Event Pass; `null` = unlimited) and stores it as `events/{id}.requestLimit` whenever the
session is projected (`services/eventProjection.ts`). The Function reads only that server-written field; it never accepts a
plan from a client. Limitation: it is refreshed on the next write of the session, so a plan/pass change in the middle of an
event is picked up late. A missing field = `event_not_ready` → the client uses the legacy endpoint. The counter is seeded from
the authoritative Supabase count the first time it is needed, so no backfill is required before enabling the Function.

**Rules.** `events/{id}/requests`: owner (`isEventOwner`) reads everything; any signed-in user reads only docs with
`guestUid == their uid` (queries must filter on it); **no client write at all**.
Index added: `requests(guestUid ASC, createdAt DESC)`.

**Realtime.**
- Guest (`useGuestRequests`): listener on *own requests only* (limit 20); legacy `my-requests` polling runs only if the guest
  has legacy ids in localStorage (fallback path), and both lists are merged.
- Guest submit: Cloud Function first; automatic fallback to the legacy Express `POST` only for infrastructure errors /
  `event_not_ready`; business errors (cooldown, limit, ended…) are shown and never retried on the legacy path.
- DJ (`useRequestsSignal`): one listener on the **open event** (limit 200) used as a **change signal**: each change re-fetches the
  authoritative legacy list, so the DJ view can never diverge from Supabase; polling relaxes from 5 s to a 60 s safety net.
- TV does not read requests today; remote still polls (public, unauthenticated). Counters: the pending count is derived from the
  list already loaded; `state/requests.total` is the cheap server counter (no reads of the collection to count).

**Backfill (emulator only).** `mashfusion-ai/backend/scripts/backfill-event-children.ts requests requests.json` projects an exported JSON of
`live_requests` rows, is idempotent, sets the counters, and refuses to run without `FIRESTORE_EMULATOR_HOST`. It never talks to Supabase.

**Function config.** `firebase/functions/.env.example`: `SUPABASE_URL`, `LEGACY_BRIDGE=supabase|none`; secret
`SUPABASE_SERVICE_ROLE_KEY` (Firebase secret, server-side only). `LEGACY_BRIDGE=none` = the Firestore-only end state.

**Tests.** `frontend: npm run test:firebase` now also builds and runs the Functions emulator with a fake PostgREST (33 tests);
`backend: npm run test:firebase` (13 tests).

**TODO.** App Check; move moderation to Functions when Supabase is retired; request limit refresh on plan change; remote
page still polling; remove the bridge, `requestLimit` bridge and `legacySupabaseId` at the end.

## Firestore: dedications (STEP 6)

Same authority model as music requests: **Supabase `live_dedications` is authoritative**, Firestore is a one-way projection,
moderation (approve/reject/delete) stays on the Express routes and is projected, clients never write.
Shared code was extracted instead of copied: Functions `src/shared/guard.ts` (error format, live-event check, atomic
reservation `reserveSlot`/`releaseSlot`, projection write with retries), backend `repositories/eventChildProjection.ts`
(generic create/status/delete projection used by requests AND dedications), frontend `lib/events/guestCallable.ts`.

**Differences from music requests** (verified in the legacy code, not assumed):
- Guests see the **approved wall of everybody**, not only their own items → rules expose `status == 'approved'` docs to any
  signed-in user (queries must filter on it); pending/rejected stay owner-only. Hence **no `guestUid` on the document**
  (it would leak anonymous uids); anti-spam is keyed by the token uid in `events/{id}/dedicationGuests/{uid}`.
- Availability: only `party`/`wedding` sessions **and** DJ with Advance or an active Event Pass. The backend projects this as
  `events/{id}.dedicationsEnabled` (legacy `hasEventAccess(dj, session)`), refreshed when the session is written; missing →
  `event_not_ready` → legacy endpoint.
- Legacy limits: 30 s cooldown per client, **no per-guest cap, no event cap**. Added: max 5 per guest per event.
  There is deliberately **no event-wide cap** and no counter (the product has none).
- `guestConfig.dedications` is **not** enforced server-side (the legacy API does not either; it only hides the UI).
- Field names: `guest_name → senderName`, `message` (≤500 server, UI maxLength 300), `status`.

**`events/{eventId}/dedications/{id}`**: `senderName`, `message`, `status (pending|approved|rejected)`, `legacySupabaseId`,
`createdAt`, `updatedAt`. Server-only: `dedicationGuests/{uid}` = `{count, lastAt}`.

**Callable `createDedication`** (2nd gen, europe-west1, minInstances 0): Auth required (anonymous OK) → validate (message 1–500,
senderName ≤80) → event exists + live → type party/wedding → `dedicationsEnabled` → atomic reserve (cooldown 30 s, 5 per guest)
→ Supabase bridge (`live_dedications`) → Firestore doc. Bridge failure rolls the reservation back. Reasons:
`unauthenticated, invalid_payload, event_not_found, event_ended, dedications_unavailable, event_not_ready, cooldown, guest_limit, bridge_failed`.

**Rules:** owner reads all; any signed-in user reads approved only; no writes; helper docs closed.
Index: `dedications(status ASC, createdAt DESC)` (guest wall, limit 50).

**Realtime.** Guest wall: `useApprovedDedications` (one listener, approved, limit 50); legacy 8 s polling is off while it is
live (one initial legacy fetch happens before the first snapshot). Submit: Function first, legacy endpoint only on
infrastructure errors / `event_not_ready`. DJ: `useDedicationsSignal` = change signal on the open event's dedications that
re-fetches the authoritative legacy list; polling 5/8 s → 60 s safety net. (The overview tile and the tab each mount the
hook; identical queries share one underlying listen in the SDK.) Remote and TV (approved dedications on the screen) still poll.

**Backfill (emulator only):** `scripts/backfill-event-children.ts <requests|dedications> rows.json` — idempotent, never touches
Supabase, refuses without `FIRESTORE_EMULATOR_HOST`.

**Legacy anomalies found:** DJ `PATCH /dedications/:id` checks `hasEventAccess(dj)` *without* the session id while `POST` checks it
*with* the session (an Event Pass bound to one session behaves differently on the two paths); the remote PATCH has no
authentication/entitlement check at all (public slug); `pending` is accepted as a target status although the UI never sends it.

**TODO.** Same as requests (App Check, move moderation to Functions, refresh `dedicationsEnabled`/limits on plan change, remove
bridge) plus: TV/remote dedications, decide whether to enforce `guestConfig.dedications` server-side.

## Firestore: polls and votes (STEP 7)

Creation, opening and closing stay on the Express/Supabase routes (**Supabase authoritative**) and are projected to
Firestore (`services/eventProjection.ts` → `repositories/pollRepository.ts`); voting goes through the `votePoll` Cloud Function.
Clients never write polls, tallies or votes.

**Legacy behaviour (verified, preserved):** options are plain strings addressed by index (2–4); creating a poll deactivates the
previous ones of the session (mirrored: the projection closes them first); the DJ can reopen/close with `is_active`;
results are shown to everybody *during* the vote; **voting again changes the choice** (upsert on `(poll_id, ip_hash)`),
legacy rate limit 1.5 s. `VOTE_POLICY.allowChange=false` (functions/src/polls/votePoll.ts) switches to "final vote"
(`already_voted`); it is tested but off, because the product allows changing.

**Model**
- `events/{eventId}/polls/{pollId}`: `question`, `options[]`, `status open|closed`, `legacySupabaseId`, timestamps.
- `…/polls/{pollId}/votes/{voterUid}`: `{ optionIndex, createdAt, updatedAt }` — doc id = the guest's Firebase uid, so one vote per
  identity is structural. No IP, no email.
- `…/polls/{pollId}/tally/{shard}`: `{ counts: { o0: n, o1: n, ... } }`. **Sharded**: guests write to `s0..s4` (stable shard =
  hash(uid) % 5) and the legacy route folds its votes into the `legacy` shard. Reading = the sum of ≤6 tiny docs. Why shards:
  one hot tally document would serialise every vote (≈1 write/s sustained) and abort transactions when a DJ says "vote now" to
  hundreds of guests. Individual shards can be negative (a changed vote decrements the old option); only the sum is shown.

**Callable `votePoll`** (`{ eventId, pollId, optionIndex }`): Auth required (anonymous OK, uid from the token) → event exists and is
live → poll exists and is `open` → `optionIndex` within the poll's options → ONE transaction: vote doc + tally shard increment
(poll status re-checked inside it) → idempotent Supabase upsert (`ip_hash = 'fb:<uid>'`) → converge check.
Reasons: `unauthenticated, invalid_payload, invalid_option, event_not_found, event_ended, poll_not_found, poll_closed, cooldown
(changing again within 1.5 s), already_voted (only if allowChange=false), event_not_ready, bridge_failed`.

**What happens when…**
- *Supabase fails:* a compensating transaction undoes our own write (deletes a new vote / restores the previous option, only if the
  vote is still the one we wrote) and `bridge_failed` is returned; the guest can retry immediately.
- *Firestore fails:* nothing was written; the client may retry.
- *The process dies after the Firestore commit and before Supabase:* Firestore is ahead. A retry with the same option is a no-op in
  Firestore but still re-sends the (idempotent) Supabase upsert, which repairs it.
- *The client retries / double clicks / refreshes:* same uid → same vote doc → one effect (`alreadyVoted: true`); the UI also reads
  `votes/{uid}`, so "already voted" survives reloads.
- *Two simultaneous calls:* by the same uid they are serialised by the transaction on `votes/{uid}`; if they carry different options
  the last committed one wins and a final read re-sends it to Supabase, so both stores converge (tested). Different guests never
  conflict (sharded counters; tested with 24 simultaneous voters).
- *Legacy-route votes:* the route reads the client's previous vote and moves one unit in the `legacy` shard, so the sum includes them.

**Rules.** Polls and tally shards: readable by any signed-in user (the product shows question and live results to guests, TV and DJ),
never writable. Votes: a guest can `get` only `votes/{theirUid}`; no `list`; **not even the owner** can read individual votes.
Index: `polls(status ASC, createdAt DESC)` (the "open poll" query).

**Realtime**
- Guest (`useActivePoll`): three small listeners — the open poll (limit 1), the tally shards (≤6 docs), the guest's own vote doc;
  never the votes. Legacy 5 s polling is off while it works. Vote: Function first, legacy endpoint only on infrastructure errors /
  `event_not_ready` (using the Supabase poll id).
- TV: the poll block comes from the same hook (overlay). **The 1.5 s polling of the whole `/screen` payload stays** because the other
  TV sections (games, photos, dedications) are not migrated; only the poll no longer depends on it.
- DJ (`usePollsSignal`): signal on the event's polls + the tally of OPEN polls, throttled to one re-fetch per 2 s, then the
  authoritative legacy list is re-fetched; polling drops to a 60 s safety net. The legacy list still computes tallies by reading the
  votes in Supabase (pre-existing cost).
- Cost note: each vote rewrites one shard doc, so every listener receives one snapshot per vote (300 guests × 300 votes ≈ 90k reads ≈
  a few cents).

**Bug fixed (STEP 4):** deleting a session removed only the event doc and slug; `deleteEventByLegacyId` now uses `recursiveDelete`
(requests, dedications, polls, votes, tallies, helper docs).

**Backfill (emulator only):** `scripts/backfill-polls.ts polls.json votes.json` creates polls and REPLACES the `legacy` shard with
counts computed from the exported votes (all pre-existing votes are legacy votes); idempotent; refuses without the emulator host.

**Tests.** frontend `npm run test:firebase` (54 tests, 11 for polls); backend `npm run test:firebase` (21).

**TODO.** App Check; moderate/close polls from Functions when Supabase is retired; remote page; slim the TV payload; poll creation limits;
decide whether voting should require an active Event Pass/Advance at vote time (the legacy vote route does not check it).

## Still on Supabase Auth (transitional)

`lib/auth/legacySupabaseAuth.ts`, `lib/supabase.ts`, `app/auth/callback/route.ts`, backend fallback in `middleware/auth.ts`
(+ `config/supabase.ts`), `@supabase/*` deps, `/user/me` auto-provision (keyed by Supabase UUID).

## Not migrated yet

Everything except users/djProfiles/events/requests/dedications/polls: games, games, photos, passes, Stripe, Storage (avatars, event photos), realtime (still polling), Express routes, Stripe/webhooks, presence.

## App Check (anti-abuse for the guest callables)

State: client integration + server observation are in place; **enforcement is OFF** (`APPCHECK_ENFORCE=false`).

- **Client** (`mashfusion-ai/frontend/lib/firebase/client.ts`): initialised once, right after `initializeApp`, only in the browser,
  never in emulator mode, only if `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` is set. Provider `enterprise` (default, reCAPTCHA
  Enterprise) or `v3` via `NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER`. The Functions SDK then attaches the token automatically.
- **Local debug token**: register a debug token in Console → App Check → Apps → Manage debug tokens, put it in
  `frontend/.env.local` as `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN=...` (git-ignored, honoured on localhost only).
- **Server** (`functions/src/index.ts`): every callable logs `app_check {fn, appCheck: valid|absent, anonymous}`; `enforceAppCheck`
  follows the param the per-callable `APPCHECK_ENFORCE_VOTE|DEDICATION|REQUEST` (`functions/.env.iomixo-494817`). To enforce: set it to `true` and redeploy the three
  callables one at a time (`firebase deploy --only functions:default:<name>`).
- **Rollout**: 1) register the web app + reCAPTCHA key in the console, 2) deploy the frontend with the site key, 3) watch the
  logs until `appCheck=valid` is the norm for real guests, 4) test with/without token, 5) only then enforce.
- Logs query: `gcloud logging read 'jsonPayload.message="app_check"' --project iomixo-494817 --freshness=1h`.

### App Check: enforcement state and cutover prerequisite

State (iomixo-494817): `APPCHECK_ENFORCE_VOTE=true`, `APPCHECK_ENFORCE_DEDICATION=true`, `APPCHECK_ENFORCE_REQUEST=true`
(`functions/.env.iomixo-494817`). Each callable reads only its own parameter. A call without a valid token is rejected by the
platform with HTTP 401 `UNAUTHENTICATED` before the handler runs (no `app_check` log line, no Firestore write).
Rollback of one callable: set its parameter to `false` and `firebase deploy --only functions:default:<name> --project iomixo-494817`.

**BLOCKING PREREQUISITE for `NEXT_PUBLIC_AUTH_PROVIDER=firebase` (cutover):** the real hosting environment (Vercel) must define
`NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY` (the public reCAPTCHA Enterprise key) and `NEXT_PUBLIC_FIREBASE_APPCHECK_PROVIDER=enterprise`,
plus the `NEXT_PUBLIC_FIREBASE_*` web config. Without them guests have no App Check token and every callable is rejected.


## Profile + avatar (PROFILE/AVATAR STEP)
- Account name → `users/{uid}.displayName`, DJ profile → `djProfiles/{uid}`: direct owner writes under `firestore.rules`. `publicSlug`, `avatarPath`, `avatarUrl` are server-only.
- Avatar bytes: browser → Storage `profiles/{uid}/avatar/{user|dj}-<random>.{jpg|png|webp}` (owner only, create-only, ≤5 MB). Then callable `commitAvatar({kind,path})`
  (owner prefix + kind, size, magic bytes, mints download token, writes `avatarPath`/`avatarUrl`, deletes the replaced file and orphans). `removeAvatar({kind})` clears + deletes.
- Guests never read `djProfiles`: name/bio/avatar/socials reach them through `getPublicEvent` (unchanged).
- Frontend: `lib/events/profileService.ts`, behind `NEXT_PUBLIC_FIRESTORE_DASHBOARD`. Backfill: `backend/scripts/backfill-profiles.ts` (+ `scripts/sql/profiles_snapshot.sql`); avatar binaries are only PLANNED (`--plan-binaries`).

## Billing (Stripe on Firebase) — implemented, NOT deployed
- Callables `createCheckoutSession({priceId, trial?, eventId?})`, `createPortalSession()` and HTTPS `stripeWebhook` (`functions/src/billing/*`). Stripe stays the provider.
- Prices: server-side table from the deploy env (`STRIPE_PRICE_*`); the client can only pick an allow-listed price. Unknown price in a webhook = explicit failure, never a fallback plan.
- Webhook: raw body + signature with its OWN secret; idempotent via `stripeEvents/{eventId}`; any handler failure answers non-2xx (Stripe retries). Writes `users/{uid}.plan` (`source:'stripe'`, `validUntil` = period end + 3 d), `subscriptions`, `payments`, `eventPasses` (validUntil = payment time + 24 h).
- Secrets only in Secret Manager: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Frontend switch: `NEXT_PUBLIC_FIREBASE_BILLING`.
- Rules: owner reads `subscriptions` / `payments` / `eventPasses`; `stripeCustomers` and `stripeEvents` are server-only.
