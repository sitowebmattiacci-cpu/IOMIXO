import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret, defineBoolean } from 'firebase-functions/params'
import { logger } from 'firebase-functions/logger'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { parseRequestInput } from './requests/validation'
import { createRequest } from './requests/createRequest'
import { bridgeFromEnv } from './requests/legacyBridge'
import { parseDedicationInput } from './dedications/validation'
import { parseVoteInput } from './polls/validation'
import { votePoll as votePollImpl } from './polls/votePoll'
import { createDedication as createDedicationImpl } from './dedications/createDedication'
import { parseModerationInput, moderateRequest as moderateRequestImpl, moderateDedication as moderateDedicationImpl } from './owner/moderation'
import { parseCreatePollInput, parseSetPollStatusInput, createPoll as createPollImpl, setPollStatus as setPollStatusImpl } from './owner/polls'
import { parseConfigInput, updateEventConfig as updateEventConfigImpl } from './owner/config'
import { parseCreateEventInput, parseEventRefInput, createEvent as createEventImpl, deleteEvent as deleteEventImpl, restoreEvent as restoreEventImpl } from './owner/sessions'
import { parseGameActionInput, parseGameConfigInput, gameAction as gameActionImpl, setGameConfig as setGameConfigImpl } from './owner/games'
import { parseCreatePhotoUploadInput, parsePhotoRefInput, parseModeratePhotoInput, createPhotoUpload as createPhotoUploadImpl, finalizePhoto as finalizePhotoImpl, moderatePhoto as moderatePhotoImpl } from './photos/photos'
import { purgeExpiredAlbums } from './albums/purge'
import { parseRequestExportInput, parseExportRefInput, requestAlbumExport as requestAlbumExportImpl, getAlbumExportUrl as getAlbumExportUrlImpl, runAlbumExport, purgeExpiredExports } from './photos/exports'
import { parseCommitAvatarInput, parseRemoveAvatarInput, commitAvatar as commitAvatarImpl, removeAvatar as removeAvatarImpl } from './profile/avatar'
import { buildPriceTable, buildMiolovePriceTable } from './billing/prices'
import { handleMioloveWebhook } from './billing/mioloveWebhook'
import { makeStripe } from './billing/stripeApi'
import { parseAlbumCheckoutInput, createAlbumCheckoutSession as createAlbumCheckoutSessionImpl } from './billing/albumCheckout'
import { parseCheckoutInput, portalOf, createCheckoutSession as createCheckoutSessionImpl, createPortalSession as createPortalSessionImpl } from './billing/checkout'
import { handleStripeWebhook } from './billing/webhook'
import { OUTBOX, drainOutbox, processOutboxItem, scanMailTriggers } from './mail/miolove/outbox'
import { parseSetMailLocaleInput, setMailLocale as setMailLocaleImpl } from './mail/miolove/locale'
import { recipientResolver } from './mail/miolove/recipient'
import { clientIpOf, parseResetInput, parseVerifyInput, sendMioloveReset as sendMioloveResetImpl, sendMioloveVerification as sendMioloveVerificationImpl, type AuthMailDeps } from './mail/miolove/authMail'
import { requireAccount } from './owner/guard'
import { dryRunTransport, mailModeOf, resendTransport, type MailTransport } from './mail/transport'
import { parseSlug, getPublicEvent as getPublicEventImpl } from './owner/publicEvent'

// Cost baseline: europe-west1, scale to zero, bounded concurrency.
setGlobalOptions({ region: 'europe-west1', minInstances: 0, maxInstances: 5, memory: '256MiB', timeoutSeconds: 30 })
if (!getApps().length) initializeApp()

// `health` lives in its own codebase (firebase/functions-health) so it can be deployed without these secrets.

// The CLI's code analysis (deploy and emulator) does NOT see values from .env files, only the shell environment.
// So here the mode only decides whether the secret is declared; the strict, fail-closed check (missing/unknown
// LEGACY_BRIDGE = error) happens in bridgeFromEnv() on every call, where the deployed .env values are present.
// TODO(firebase-migration): the secret exists only while the Supabase bridge is on; remove with LEGACY_BRIDGE.
// To deploy WITH the Supabase bridge, LEGACY_BRIDGE=supabase must also be exported in the deploying shell.
// With mock/none/unset nothing references the secret, so Secret Manager is never touched.
const SECRETS = process.env.LEGACY_BRIDGE === 'supabase' ? [defineSecret('SUPABASE_SERVICE_ROLE_KEY')] : []

/** Dedicated least-privilege identity (roles/datastore.user + roles/logging.logWriter only). */
const SERVICE_ACCOUNT = 'iomixo-functions@iomixo-494817.iam.gserviceaccount.com'

// App Check enforcement, one explicit parameter PER callable (values from .env.<project>; default false, no shared switch).
// When enforced, the platform rejects a call without a valid token BEFORE the handler runs (no log line, no write).
// request.app is set only for valid tokens. The structured log never contains the token.
const ENFORCE_REQUEST    = defineBoolean('APPCHECK_ENFORCE_REQUEST',    { default: false })
const ENFORCE_DEDICATION = defineBoolean('APPCHECK_ENFORCE_DEDICATION', { default: false })
const ENFORCE_VOTE       = defineBoolean('APPCHECK_ENFORCE_VOTE',       { default: false })
// Guest photo upload (createPhotoUpload / finalizePhoto): observe-only until verified on the web client, like the owner callables.
const ENFORCE_PHOTO      = defineBoolean('APPCHECK_ENFORCE_PHOTO',      { default: false })
// Owner-side callables (moderation, polls, event settings) and the public event lookup: same convention, default false (observe only).
const ENFORCE_OWNER        = defineBoolean('APPCHECK_ENFORCE_OWNER',        { default: false })
const ENFORCE_PUBLIC_EVENT = defineBoolean('APPCHECK_ENFORCE_PUBLIC_EVENT', { default: false })
// Billing callables (checkout / portal): same convention, default false (observe only) until App Check is verified on the web client.
const ENFORCE_BILLING      = defineBoolean('APPCHECK_ENFORCE_BILLING',      { default: false })
// MIOLOVE account e-mails (verification / password reset): same convention, default false (observe only) until App Check is verified on the MIOLOVE web client.
const ENFORCE_AUTHMAIL      = defineBoolean('APPCHECK_ENFORCE_AUTHMAIL',      { default: false })
// Stripe secrets live ONLY in Secret Manager (`firebase functions:secrets:set STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET`); the webhook secret belongs to THIS endpoint.
const STRIPE_SECRET_KEY    = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
// MIOLOVE has its OWN Stripe account: its own secret key and its own webhook secret (the IOMIXO ones above are never used for MIOLOVE, nor these for IOMIXO).
const STRIPE_MIOLOVE_SECRET_KEY     = defineSecret('STRIPE_MIOLOVE_SECRET_KEY')
const STRIPE_MIOLOVE_WEBHOOK_SECRET = defineSecret('STRIPE_MIOLOVE_WEBHOOK_SECRET')
const observeAppCheck = (
  fn: string, enforced: { value(): boolean },
  request: { app?: unknown; auth?: { token?: { firebase?: { sign_in_provider?: string } } } },
) => logger.info('app_check', {
  fn, appCheck: request.app ? 'valid' : 'absent', anonymous: request.auth?.token?.firebase?.sign_in_provider === 'anonymous',
  enforcement: enforced.value(),
})

const guestCallOptions = (enforceAppCheck: typeof ENFORCE_VOTE) => ({
  enforceAppCheck,
  cors: [
    'https://www.iomixo.com', 'https://iomixo.com', 'https://miolovealbum.com', 'https://www.miolovealbum.com',
    'https://iomixo-web--iomixo-494817.europe-west4.hosted.app', 'http://localhost:3000', 'http://localhost:3100',
  ],
  secrets: SECRETS,
  serviceAccount: SERVICE_ACCOUNT,
})

/**
 * Callable: a guest (Firebase anonymous or signed-in) sends a music request.
 * Identity comes from the verified auth token only; clients cannot create requests in Firestore directly.
 */
export const createMusicRequest = onCall(
  guestCallOptions(ENFORCE_REQUEST),
  async (request) => {
    observeAppCheck('createMusicRequest', ENFORCE_REQUEST, request)
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
    const input = parseRequestInput(request.data)
    return createRequest(getFirestore(), bridgeFromEnv(), request.auth.uid, input)
  },
)

/** Callable: a guest sends a dedication (Party / Wedding sessions with Advance or Event Pass). Same rules as above. */
export const createDedication = onCall(guestCallOptions(ENFORCE_DEDICATION), async (request) => {
  observeAppCheck('createDedication', ENFORCE_DEDICATION, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  const input = parseDedicationInput(request.data)
  return createDedicationImpl(getFirestore(), bridgeFromEnv(), request.auth.uid, input)
})

/** Callable: a guest votes (or changes their vote) on the open poll of an event. One vote per guest uid. */
export const votePoll = onCall(guestCallOptions(ENFORCE_VOTE), async (request) => {
  observeAppCheck('votePoll', ENFORCE_VOTE, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  return votePollImpl(getFirestore(), bridgeFromEnv(), request.auth.uid, parseVoteInput(request.data))
})

// ── Owner callables (STEP: runtime independence from Render/Supabase for the migrated owner) ───────────────────────────────────
// Identity = verified token, ownership = events/{id}.ownerUid (owner/guard.ts). No bridge: these write Firestore only.
// The client never sends an owner id, a status transition table or any server field.
const ownerCallOptions = { ...guestCallOptions(ENFORCE_OWNER), secrets: [] }
const ownerCall = <I, O>(name: string, parse: (d: unknown) => I, run: (req: { auth?: any }, input: I) => Promise<O>) =>
  onCall(ownerCallOptions, async (request) => {
    observeAppCheck(name, ENFORCE_OWNER, request)
    return run(request, parse(request.data))
  })

export const moderateRequest    = ownerCall('moderateRequest',    (d) => parseModerationInput(d, 'requestId'),    (r, i) => moderateRequestImpl(getFirestore(), r, i))
export const moderateDedication = ownerCall('moderateDedication', (d) => parseModerationInput(d, 'dedicationId'), (r, i) => moderateDedicationImpl(getFirestore(), r, i))
export const createPoll         = ownerCall('createPoll',         parseCreatePollInput,    (r, i) => createPollImpl(getFirestore(), r, i))
export const setPollStatus      = ownerCall('setPollStatus',      parseSetPollStatusInput, (r, i) => setPollStatusImpl(getFirestore(), r, i))
export const updateEventConfig  = ownerCall('updateEventConfig',  parseConfigInput,        (r, i) => updateEventConfigImpl(getFirestore(), r, i))

// Event lifecycle + games (Firestore-authoritative; no Supabase). Same App Check parameter as the other owner callables.
export const createEvent        = ownerCall('createEvent',        parseCreateEventInput, (r, i) => createEventImpl(getFirestore(), r, i))
export const deleteEvent        = ownerCall('deleteEvent',        parseEventRefInput,    (r, i) => deleteEventImpl(getFirestore(), r, i))
export const restoreEvent       = ownerCall('restoreEvent',       parseEventRefInput,    (r, i) => restoreEventImpl(getFirestore(), r, i))
export const ownerGameAction    = ownerCall('ownerGameAction',    parseGameActionInput,  (r, i) => gameActionImpl(getFirestore(), r, i))
export const setGameConfig      = ownerCall('setGameConfig',      parseGameConfigInput,  (r, i) => setGameConfigImpl(getFirestore(), r, i))

// Profile avatar (settings + public DJ profile): bytes go to Storage under storage.rules; these two callables are the only writers of avatarPath/avatarUrl.
export const commitAvatar      = ownerCall('commitAvatar',       parseCommitAvatarInput, (r, i) => commitAvatarImpl(getFirestore(), r as any, i))
export const removeAvatar      = ownerCall('removeAvatar',       parseRemoveAvatarInput, (r, i) => removeAvatarImpl(getFirestore(), r as any, i))

export const moderatePhoto      = ownerCall('moderatePhoto',      parseModeratePhotoInput, (r, i) => moderatePhotoImpl(getFirestore(), r, i))

// Album export ("download everything" as ONE archive of the originals). The owner asks, a Firestore trigger builds the ZIP by streaming (photos/exports.ts),
// the owner follows the export doc and fetches a fresh URL when it is ready. Two operations of the same App Check family as the other owner callables.
export const requestAlbumExport = ownerCall('requestAlbumExport', parseRequestExportInput, (r, i) => requestAlbumExportImpl(getFirestore(), r, i))
export const getAlbumExportUrl  = ownerCall('getAlbumExportUrl',  parseExportRefInput,     (r, i) => getAlbumExportUrlImpl(getFirestore(), r, i))
export const onAlbumExportCreated = onDocumentCreated(
  { document: 'events/{eventId}/exports/{exportId}', memory: '1GiB', timeoutSeconds: 540, maxInstances: 3, serviceAccount: SERVICE_ACCOUNT },
  async (event) => { await runAlbumExport(getFirestore(), event.params.eventId, event.params.exportId) },
)
// An export archive is a private download link: this deletes the expired ones (24 h) even when the owner never asks again. Needs Cloud Scheduler at deploy time.
export const purgeAlbumExports = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Europe/Rome', memory: '256MiB', timeoutSeconds: 300, maxInstances: 1, serviceAccount: SERVICE_ACCOUNT },
  async () => { const r = await purgeExpiredExports(getFirestore()); logger.info('purgeAlbumExports', r) },
)

// Retention: a paid album lives 365 days from its activation, an unpaid trial 7 days + a 30-day recovery window; then ALL its content is deleted for real (Storage + Firestore),
// keeping only payments / audit records (albums/purge.ts). Idempotent and resumable: a failed album is retried by the next run. Never touches IOMIXO events. Needs Cloud Scheduler at deploy time.
export const purgeExpiredMioloveAlbums = onSchedule(
  { schedule: 'every day 03:30', timeZone: 'Europe/Rome', memory: '512MiB', timeoutSeconds: 540, maxInstances: 1, serviceAccount: SERVICE_ACCOUNT },
  async () => { const r = await purgeExpiredAlbums(getFirestore()); logger.info('purgeExpiredMioloveAlbums', r) },
)

// ── MIOLOVE e-mails (Resend). Separate secret, sender, templates and outbox from anything IOMIXO; only MIOLOVE albums ever produce one (mail/miolove/*). ───────────────────────
// `firebase functions:secrets:set RESEND_MIOLOVE_API_KEY`; MIOLOVE_MAIL_MODE=live switches sending on (unset = the queue just waits, dry = emulator / tests: nothing leaves).
const RESEND_MIOLOVE_API_KEY = defineSecret('RESEND_MIOLOVE_API_KEY')
const mioloveMailDeps = (): { deps: Parameters<typeof processOutboxItem>[0] | null } => {
  const mode = mailModeOf(process.env.MIOLOVE_MAIL_MODE)
  if (mode === 'off') return { deps: null }
  const transport: MailTransport = mode === 'live' ? resendTransport(RESEND_MIOLOVE_API_KEY.value()) : dryRunTransport()
  const allow = (process.env.MIOLOVE_MAIL_ALLOWLIST ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)       // optional staging filter: only these recipients get mail, every other e-mail is HELD in the queue (never sent / skipped)
  return {
    deps: {
      db: getFirestore(), transport, baseUrl: process.env.MIOLOVE_BASE_URL || undefined,
      resolveRecipient: recipientResolver((uid) => getAuth().getUser(uid)),       // only "user not found" = no address; any other error is retried by the outbox
      ...(allow.length ? { allowRecipient: (email: string) => allow.includes(email.toLowerCase()) } : {}),
    },
  }
}
const MAIL_FN = { secrets: [RESEND_MIOLOVE_API_KEY], serviceAccount: SERVICE_ACCOUNT, memory: '256MiB' as const, timeoutSeconds: 300, maxInstances: 3 }

/** A new e-mail was queued: send it right away. If this fails or is disabled, the scheduler below picks it up (retries with back-off). */
export const onMioloveMailQueued = onDocumentCreated({ document: `${OUTBOX}/{key}`, ...MAIL_FN }, async (event) => {
  const { deps } = mioloveMailDeps()
  if (!deps) { logger.warn('miolove_mail_disabled', { key: event.params.key }); return }
  logger.info('miolove_mail', { key: event.params.key, result: await processOutboxItem(deps, event.params.key) })
})
/** Every 10 minutes: retries, expired leases, anything queued while sending was off. */
export const drainMioloveMail = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Europe/Rome', ...MAIL_FN, maxInstances: 1 }, async () => {
  const { deps } = mioloveMailDeps()
  if (!deps) return
  logger.info('drainMioloveMail', await drainOutbox(deps))
})
/** Every day 09:00 (Rome): queues the due trial / expiry reminders, one e-mail per album. Only writes outbox documents. */
export const scanMioloveMailTriggers = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Europe/Rome', memory: '256MiB', timeoutSeconds: 540, maxInstances: 1, serviceAccount: SERVICE_ACCOUNT },
  async () => { logger.info('scanMioloveMailTriggers', await scanMailTriggers(getFirestore())) },
)
/** Callable: remembers the language of the signed-in account's e-mails (the browser sends it when the language changes). */
export const setMailLocale = ownerCall('setMailLocale', parseSetMailLocaleInput, (r, i) => setMailLocaleImpl(getFirestore(), r, i))

// ── MIOLOVE account e-mails (address verification / password reset): Admin SDK link + Resend, mail/miolove/authMail.ts. IOMIXO accounts keep the Firebase templates untouched. ───────
/** Dedicated identity of these two callables: it alone may generate Auth action links (custom role: firebaseauth.users.get + firebaseauth.users.sendEmail), so the other functions never can. */
const AUTHMAIL_SERVICE_ACCOUNT = 'iomixo-authmail@iomixo-494817.iam.gserviceaccount.com'
const mioloveAuthMailDeps = (): AuthMailDeps => {
  const mode = mailModeOf(process.env.MIOLOVE_MAIL_MODE)
  const allow = (process.env.MIOLOVE_MAIL_ALLOWLIST ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  const auth = getAuth()
  return {
    db: getFirestore(), enabled: mode !== 'off', baseUrl: process.env.MIOLOVE_BASE_URL || undefined,
    transport: mode === 'live' ? resendTransport(RESEND_MIOLOVE_API_KEY.value()) : dryRunTransport(),
    auth: {
      getUser: (uid) => auth.getUser(uid), getUserByEmail: (email) => auth.getUserByEmail(email),
      generateEmailVerificationLink: (email) => auth.generateEmailVerificationLink(email),
      generatePasswordResetLink: (email) => auth.generatePasswordResetLink(email),
    },
    ...(allow.length ? { allowRecipient: (email: string) => allow.includes(email.toLowerCase()) } : {}),
  }
}
const AUTHMAIL_FN = { ...guestCallOptions(ENFORCE_AUTHMAIL), secrets: [RESEND_MIOLOVE_API_KEY], serviceAccount: AUTHMAIL_SERVICE_ACCOUNT }
/** Callable (signed-in MIOLOVE account): sends the branded verification e-mail to the caller's own address. The address is never taken from the payload. */
export const sendMioloveVerification = onCall(AUTHMAIL_FN, async (request) => {
  observeAppCheck('sendMioloveVerification', ENFORCE_AUTHMAIL, request)
  const uid = requireAccount(request)
  return sendMioloveVerificationImpl(mioloveAuthMailDeps(), uid, parseVerifyInput(request.data).locale)
})
/** Callable (public): branded password-reset e-mail. Always answers { ok: true } after a fixed minimum time, whatever the address (no account enumeration); throttled per address and per IP. */
export const sendMioloveReset = onCall(AUTHMAIL_FN, async (request) => {
  observeAppCheck('sendMioloveReset', ENFORCE_AUTHMAIL, request)
  const i = parseResetInput(request.data)
  return sendMioloveResetImpl(mioloveAuthMailDeps(), { email: i.email, locale: i.locale, ip: clientIpOf(request.rawRequest) })
})

// Guest photo callables: identity = verified token (anonymous allowed). Bytes never pass through them (the client writes to Storage under storage.rules).
const photoCallOptions = { ...guestCallOptions(ENFORCE_PHOTO), secrets: [] }
export const createPhotoUpload = onCall(photoCallOptions, async (request) => {
  observeAppCheck('createPhotoUpload', ENFORCE_PHOTO, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  return createPhotoUploadImpl(getFirestore(), request.auth.uid, parseCreatePhotoUploadInput(request.data))
})
export const finalizePhoto = onCall(photoCallOptions, async (request) => {
  observeAppCheck('finalizePhoto', ENFORCE_PHOTO, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  return finalizePhotoImpl(getFirestore(), request.auth.uid, parsePhotoRefInput(request.data))
})

/** Callable: public event lookup by slug (replaces GET /api/live/public/:slug). Any signed-in identity, incl. anonymous guests. */
export const getPublicEvent = onCall({ ...guestCallOptions(ENFORCE_PUBLIC_EVENT), secrets: [] }, async (request) => {
  observeAppCheck('getPublicEvent', ENFORCE_PUBLIC_EVENT, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  return getPublicEventImpl(getFirestore(), parseSlug(request.data))
})

// ── Billing (Stripe stays the payment provider; Firestore + these Functions replace Render/Supabase) ───────────────────────────
// Prices are server-side (billing/prices.ts, ids from the non-secret deploy env). The client sends a price id, a trial flag and an optional event id only.
const billingCallOptions = { ...guestCallOptions(ENFORCE_BILLING), secrets: [STRIPE_SECRET_KEY] }
const billingConfig = () => ({ baseUrl: process.env.APP_BASE_URL || 'https://www.iomixo.com', coupleBaseUrl: process.env.MIOLOVE_BASE_URL || undefined })

/** Callable: starts a Stripe Checkout (subscription / trial / Event Pass) for the signed-in account. */
export const createCheckoutSession = onCall(billingCallOptions, async (request) => {
  observeAppCheck('createCheckoutSession', ENFORCE_BILLING, request)
  return createCheckoutSessionImpl(getFirestore(), makeStripe(STRIPE_SECRET_KEY.value()), buildPriceTable(), billingConfig(), request.auth as any, parseCheckoutInput(request.data))
})

/** Callable: starts the one-time Stripe Checkout that activates ONE MIOLOVE album (price / currency / URLs decided here). Activation itself is the webhook's job. */
export const createAlbumCheckoutSession = onCall({ ...guestCallOptions(ENFORCE_BILLING), secrets: [STRIPE_MIOLOVE_SECRET_KEY] }, async (request) => {
  observeAppCheck('createAlbumCheckoutSession', ENFORCE_BILLING, request)
  return createAlbumCheckoutSessionImpl(getFirestore(), makeStripe(STRIPE_MIOLOVE_SECRET_KEY.value()), buildMiolovePriceTable(), billingConfig(), request.auth as any, parseAlbumCheckoutInput(request.data))
})

/** HTTPS: MIOLOVE Stripe webhook (the MIOLOVE Stripe account only). Separate endpoint + secret from `stripeWebhook`: it activates album purchases and does nothing else. */
export const mioloveStripeWebhook = onRequest(
  { cors: false, secrets: [STRIPE_MIOLOVE_SECRET_KEY, STRIPE_MIOLOVE_WEBHOOK_SECRET], serviceAccount: SERVICE_ACCOUNT },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return }
    const r = await handleMioloveWebhook(
      { db: getFirestore(), stripe: makeStripe(STRIPE_MIOLOVE_SECRET_KEY.value()), prices: buildMiolovePriceTable() },
      { rawBody: req.rawBody, signature: req.header('stripe-signature'), secret: STRIPE_MIOLOVE_WEBHOOK_SECRET.value() },
    )
    res.status(r.status).json(r.body)
  },
)

/** Callable: Stripe Billing Portal for the signed-in account's customer. */
export const createPortalSession = onCall(billingCallOptions, async (request) => {
  observeAppCheck('createPortalSession', ENFORCE_BILLING, request)
  return createPortalSessionImpl(getFirestore(), makeStripe(STRIPE_SECRET_KEY.value()), billingConfig(), request.auth as any, portalOf(request.data))
})

/** HTTPS: Stripe webhook. Raw body + signature, idempotent per event id; any handler failure answers non-2xx so Stripe retries. */
export const stripeWebhook = onRequest(
  { cors: false, secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], serviceAccount: SERVICE_ACCOUNT },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return }
    const r = await handleStripeWebhook(
      { db: getFirestore(), stripe: makeStripe(STRIPE_SECRET_KEY.value()), prices: buildPriceTable() },
      { rawBody: req.rawBody, signature: req.header('stripe-signature'), secret: STRIPE_WEBHOOK_SECRET.value() },
    )
    res.status(r.status).json(r.body)
  },
)
