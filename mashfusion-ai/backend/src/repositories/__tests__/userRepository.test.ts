/**
 * Runs only against the Firestore emulator:
 *   npm run test:firebase   (wraps firebase emulators:exec)
 * Skipped in the normal `npm test`.
 */
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
// Loaded lazily: firebase-admin pulls ESM-only deps that Jest cannot parse unless actually needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const repo: typeof import('../userRepository') = emu ? require('../userRepository') : (undefined as never)
const { ensureUser, getUserByUid, getUserByLegacyId, linkLegacySupabaseId, setPlan, getPlanTier, getEntitlements } =
  (repo ?? {}) as typeof import('../userRepository')
const d = emu ? describe : describe.skip
const uid = () => `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

d('userRepository (Firestore emulator)', () => {
  it('6. creates the owner document with free/default plan and does not overwrite it later', async () => {
    const id = uid()
    const u = await ensureUser({ uid: id, email: 'owner@iomixo.local', displayName: 'Owner' })
    expect(u.plan).toMatchObject({ tier: 'free', source: 'default' })
    await setPlan(id, { tier: 'pro', source: 'legacy' })
    await ensureUser({ uid: id, email: 'owner@iomixo.local' }) // idempotent, keeps plan
    expect((await getUserByUid(id))?.plan.tier).toBe('pro')
  })

  it('links legacySupabaseId and resolves by it', async () => {
    const id = uid(); const legacy = `00000000-0000-0000-0000-${Date.now()}`
    await ensureUser({ uid: id, email: 'a@b.it' })
    await linkLegacySupabaseId(id, legacy)
    expect((await getUserByLegacyId(legacy))?.uid).toBe(id)
    expect(await getUserByLegacyId('missing')).toBeNull()
  })

  it('derives entitlements from the tier; unknown user is free', async () => {
    const id = uid()
    expect(await getPlanTier(id)).toBe('free')
    await ensureUser({ uid: id, email: 'a@b.it' })
    await setPlan(id, { tier: 'wedding', source: 'stripe', validUntil: new Date(Date.now() + 86_400_000) })
    expect(await getPlanTier(id)).toBe('wedding')
    expect((await getEntitlements(id)).weddingMode).toBe(true)
    expect((await getUserByUid(id))?.plan.validUntil).toBeInstanceOf(Date)
  })
})

export {} // make this file a module (avoids global-scope name clashes between tests)
