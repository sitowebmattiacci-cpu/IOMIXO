/** Emulator-only (npm run test:firebase): legacy plan / event_passes → Firestore projection, versioned. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const repo: typeof import('../entitlementRepository') = emu ? require('../entitlementRepository') : (undefined as never)
const userRepo: typeof import('../userRepository') = emu ? require('../userRepository') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const v = (n: number) => `2026-02-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const mkUser = async () => {
  const fbUid = `fu-${uid()}`, legacy = `lu-${uid()}`
  await userRepo.ensureUser({ uid: fbUid, email: `${fbUid}@example.com` })
  await userRepo.linkLegacySupabaseId(fbUid, legacy)
  return { fbUid, legacy }
}
const pass = (user_id: string, over: Record<string, unknown> = {}) => ({
  id: `ep-${uid()}`, user_id, session_id: null, stripe_payment_intent_id: `pi_${uid()}`, amount_cents: 799, currency: 'eur',
  valid_until: '2026-02-02T10:00:00+00:00', status: 'active' as const, created_at: '2026-02-01T10:00:00.000100+00:00', updated_at: v(0), ...over,
})
const passDoc = async (fbUid: string, key: string) => (await firestore().collection('users').doc(fbUid).collection('eventPasses').doc(key).get()).data()
const userDoc = async (fbUid: string) => (await firestore().collection('users').doc(fbUid).get()).data()

d('entitlementRepository projection (Firestore emulator)', () => {
  it('projects a pass keyed by the payment intent, with legacy ids, scope and DB timestamps', async () => {
    const { fbUid, legacy } = await mkUser(); const p = pass(legacy, { session_id: 'sess-1' })
    expect(await repo.projectEventPass(p as any)).toBe('created')
    const doc = await passDoc(fbUid, p.stripe_payment_intent_id)
    expect(doc).toMatchObject({ status: 'active', legacySessionId: 'sess-1', source: 'legacy', legacySupabaseId: p.id, stripePaymentIntentId: p.stripe_payment_intent_id, amountCents: 799, currency: 'eur' })
    expect(doc.validUntil.toDate().toISOString()).toBe('2026-02-02T10:00:00.000Z')
    expect(doc.createdAt.nanoseconds).toBe(100000)
  })

  it('key falls back to legacy-<id> without a payment intent; unknown user / invalid row are not projected', async () => {
    const { fbUid, legacy } = await mkUser(); const p = pass(legacy, { stripe_payment_intent_id: null })
    expect(await repo.projectEventPass(p as any)).toBe('created'); expect(await passDoc(fbUid, `legacy-${p.id}`)).toBeDefined()
    expect(await repo.projectEventPass(pass(`ghost-${uid()}`) as any)).toBe('no_user')
    expect(await repo.projectEventPass(pass(legacy, { status: 'weird' }) as any)).toBe('invalid')
    expect(await repo.projectEventPass(pass(legacy, { valid_until: 'soon' }) as any)).toBe('invalid')
  })

  it('refund (newer version) revokes; replay is a duplicate; an older version is ignored; webhook replays do not duplicate', async () => {
    const { fbUid, legacy } = await mkUser(); const p = pass(legacy)
    await repo.projectEventPass(p as any)
    expect(await repo.projectEventPass({ ...p } as any)).toBe('duplicate')
    expect(await repo.projectEventPass({ ...p, status: 'refunded', updated_at: v(5) } as any)).toBe('applied')
    expect((await passDoc(fbUid, p.stripe_payment_intent_id)).status).toBe('refunded')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await repo.projectEventPass({ ...p, status: 'active', updated_at: v(2) } as any)).toBe('stale_ignored')
    expect((await passDoc(fbUid, p.stripe_payment_intent_id)).status).toBe('refunded')
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ projection: 'eventPasses', result: 'stale_ignored' }); warn.mockRestore()
    expect((await firestore().collection('users').doc(fbUid).collection('eventPasses').get()).size).toBe(1)
  })

  it('50 concurrent old/new pass pairs (refund racing the activation) → always the newer state', async () => {
    const { fbUid, legacy } = await mkUser()
    const out = await Promise.all(Array.from({ length: 50 }, async () => {
      const p = pass(legacy); await repo.projectEventPass(p as any)
      const order = Math.random() < 0.5 ? [{ ...p, status: 'active', updated_at: v(1) }, { ...p, status: 'refunded', updated_at: v(2) }] : [{ ...p, status: 'refunded', updated_at: v(2) }, { ...p, status: 'active', updated_at: v(1) }]
      await Promise.all(order.map((r) => repo.projectEventPass(r as any)))
      return (await passDoc(fbUid, p.stripe_payment_intent_id)).status
    }))
    expect(out.filter((s) => s !== 'refunded')).toHaveLength(0)
  })

  it('plan: legacy tier (aliases normalized) → source legacy; versioned; never overwrites a Firestore-authoritative (stripe) plan', async () => {
    const { fbUid, legacy } = await mkUser()
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'advance', updated_at: v(1) })).toBe('applied')
    expect((await userDoc(fbUid)).plan).toEqual({ tier: 'wedding', source: 'legacy' })
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'advance', updated_at: v(1) })).toBe('duplicate')
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'free', updated_at: v(0) })).toBe('stale_ignored'); warn.mockRestore()
    expect((await userDoc(fbUid)).plan.tier).toBe('wedding')
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'pro', updated_at: v(3) })).toBe('applied')   // downgrade wedding → pro
    expect((await userDoc(fbUid)).plan.tier).toBe('pro')
    await userRepo.setPlan(fbUid, { tier: 'wedding', source: 'stripe' })
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'free', updated_at: v(9) })).toBe('authority_firestore')
    expect((await userDoc(fbUid)).plan).toMatchObject({ tier: 'wedding', source: 'stripe' })
    expect(await repo.projectLegacyPlan({ id: `ghost-${uid()}`, plan: 'pro', updated_at: v(1) })).toBe('no_user')
    expect(await repo.projectLegacyPlan({ id: legacy, plan: 'pro', updated_at: 'x' })).toBe('invalid')
  })
})
