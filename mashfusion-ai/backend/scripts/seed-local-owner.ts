/**
 * Creates (or resets) a local owner account in the Firebase AUTH EMULATOR only.
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx ts-node --transpile-only scripts/seed-local-owner.ts [email] [password] [supabaseUuid] [free|pro|wedding]
 * The optional Supabase UUID is stored (a) as the server-side custom claim `legacyUserId` and
 * (b) as `legacySupabaseId` on users/{uid}, bridging the Firebase UID to the existing Supabase rows.
 * Also creates users/{uid} in the Firestore emulator (plan: given tier, source 'legacy' when linked).
 */
import { firebaseAuth } from '../src/lib/firebaseAdmin'
import { ensureUser, linkLegacySupabaseId, setPlan } from '../src/repositories/userRepository'
import type { PlanTier } from '../src/config/plans'

;(async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Refusing to run: FIREBASE_AUTH_EMULATOR_HOST is not set (emulator only)')
  const [email = 'owner@iomixo.local', password = 'password123', legacyUserId, tier = 'free'] = process.argv.slice(2)
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (emulator only)')
  const auth = firebaseAuth()
  const user = await auth.getUserByEmail(email).catch(() => null) ?? await auth.createUser({ email, password, emailVerified: true, displayName: 'Local Owner' })
  if (legacyUserId) await auth.setCustomUserClaims(user.uid, { legacyUserId })
  await ensureUser({ uid: user.uid, email, displayName: user.displayName })
  if (legacyUserId) {
    await linkLegacySupabaseId(user.uid, legacyUserId)
    await setPlan(user.uid, { tier: tier as PlanTier, source: 'legacy' })
  }
  console.log(`owner ready: ${email} uid=${user.uid}${legacyUserId ? ` legacyUserId=${legacyUserId}` : ''}`)
})()
