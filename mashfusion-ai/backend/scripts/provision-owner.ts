/**
 * Provisions the REAL owner in Firebase AFTER the user exists in Firebase Auth (created by the owner in the
 * console, so no password ever passes through this script or the repo):
 *   1. sets the server-side custom claim `legacyUserId` (TRANSITIONAL: Supabase users.id, read by the Express
 *      auth adapter as req.user.sub) — clients cannot set custom claims;
 *   2. creates users/{firebaseUid} with `legacySupabaseId` and the VERIFIED legacy plan.
 *
 *   emulator : FIREBASE_AUTH_EMULATOR_HOST=… FIRESTORE_EMULATOR_HOST=… npx ts-node --transpile-only scripts/provision-owner.ts --email … --legacy-id … --plan …
 *   cloud    : FIREBASE_PROJECT_ID=iomixo-494817 (+ Application Default Credentials) … add --yes-cloud
 *
 * --plan is mandatory on purpose: no tier is ever guessed. Never prints secrets. Does not touch Supabase.
 */
import { firebaseAuth } from '../src/lib/firebaseAdmin'
import { ensureUser, linkLegacySupabaseId, setPlan, getUserByUid } from '../src/repositories/userRepository'
import type { PlanTier } from '../src/config/plans'

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIERS: PlanTier[] = ['free', 'pro', 'wedding']

;(async () => {
  const email = arg('email'), legacyId = arg('legacy-id'), plan = arg('plan') as PlanTier | undefined
  if (!email || !legacyId || !plan) throw new Error('usage: provision-owner.ts --email <email> --legacy-id <supabase uuid> --plan <free|pro|wedding> [--yes-cloud]')
  if (!UUID.test(legacyId)) throw new Error('--legacy-id is not a valid UUID')
  if (!TIERS.includes(plan)) throw new Error(`--plan must be one of ${TIERS.join('|')}`)

  const emulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST)
  if (emulator !== Boolean(process.env.FIRESTORE_EMULATOR_HOST)) throw new Error('Set BOTH emulator hosts or none')
  if (!emulator) {
    if (process.env.FIREBASE_PROJECT_ID !== 'iomixo-494817') throw new Error('Cloud mode requires FIREBASE_PROJECT_ID=iomixo-494817')
    if (!process.argv.includes('--yes-cloud')) throw new Error('Cloud mode requires --yes-cloud')
  }

  const auth = firebaseAuth()
  const user = await auth.getUserByEmail(email).catch(() => null)
  if (!user) throw new Error('No Firebase Auth user with that email: create it first (console → Authentication → Users → Add user)')

  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), legacyUserId: legacyId })
  await ensureUser({ uid: user.uid, email, displayName: user.displayName })
  await linkLegacySupabaseId(user.uid, legacyId)
  await setPlan(user.uid, { tier: plan, source: 'legacy' })

  const check = await auth.getUser(user.uid)
  const doc = await getUserByUid(user.uid)
  const ok = check.customClaims?.legacyUserId === legacyId && doc?.legacySupabaseId === legacyId && doc?.plan.tier === plan
  console.log(JSON.stringify({
    mode: emulator ? 'emulator' : 'cloud', uid: user.uid, email, emailVerified: user.emailVerified,
    claim_legacyUserId_set: check.customClaims?.legacyUserId === legacyId,
    users_doc: doc && { legacySupabaseId: doc.legacySupabaseId, plan: doc.plan },
    note: 'Existing ID tokens keep the old claims: sign out/in (or getIdToken(true)) to receive legacyUserId.',
    ok,
  }, null, 2))
  if (!ok) process.exit(1)
})().catch((e) => { console.error(e.message); process.exit(1) })
