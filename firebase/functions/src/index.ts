import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret, defineBoolean } from 'firebase-functions/params'
import { logger } from 'firebase-functions/logger'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
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
// Owner-side callables (moderation, polls, event settings) and the public event lookup: same convention, default false (observe only).
const ENFORCE_OWNER        = defineBoolean('APPCHECK_ENFORCE_OWNER',        { default: false })
const ENFORCE_PUBLIC_EVENT = defineBoolean('APPCHECK_ENFORCE_PUBLIC_EVENT', { default: false })
const observeAppCheck = (
  fn: string, enforced: { value(): boolean },
  request: { app?: unknown; auth?: { token?: { firebase?: { sign_in_provider?: string } } } },
) => logger.info('app_check', {
  fn, appCheck: request.app ? 'valid' : 'absent', anonymous: request.auth?.token?.firebase?.sign_in_provider === 'anonymous',
  enforcement: enforced.value(),
})

const guestCallOptions = (enforceAppCheck: typeof ENFORCE_VOTE) => ({
  enforceAppCheck,
  cors: ['https://www.iomixo.com', 'https://iomixo.com', 'http://localhost:3000', 'http://localhost:3100'],
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

/** Callable: public event lookup by slug (replaces GET /api/live/public/:slug). Any signed-in identity, incl. anonymous guests. */
export const getPublicEvent = onCall({ ...guestCallOptions(ENFORCE_PUBLIC_EVENT), secrets: [] }, async (request) => {
  observeAppCheck('getPublicEvent', ENFORCE_PUBLIC_EVENT, request)
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required', { reason: 'unauthenticated' })
  return getPublicEventImpl(getFirestore(), parseSlug(request.data))
})
