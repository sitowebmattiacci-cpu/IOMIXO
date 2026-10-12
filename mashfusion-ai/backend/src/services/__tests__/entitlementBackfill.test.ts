/** Emulator-only (npm run test:firebase): entitlement backfill — mapping, policy, idempotency, guards, rollback. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../entitlementBackfill') = emu ? require('../entitlementBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const v = (n: number) => `2026-02-01T10:00:00.${String(100000 + n).padStart(6, '0')}+00:00`
const H = 3600_000
const OPTS = { apply: false, projectId: 'demo-iomixo' }
const APPLY = { apply: true, projectId: 'demo-iomixo' }

/** Firebase side: a users/{uid} doc that carries the legacy id (this is what the mapping uses). */
async function fbUser(legacy: string, plan: Record<string, unknown> = { tier: 'free', source: 'default' }, extra: Record<string, unknown> = {}) {
  const fb = `fb-${uid()}`
  await firestore().doc(`users/${fb}`).set({ uid: fb, email: `${fb}@example.com`, plan, legacySupabaseId: legacy, createdAt: new Date(), updatedAt: new Date(), ...extra })
  return fb
}
const lu = (over: Record<string, unknown> = {}) => ({ id: `lu-${uid()}`, email: `u${uid()}@example.com`, plan: 'free', stripe_customer_id: null, created_at: v(0), updated_at: v(1), ...over })
const lp = (user_id: string, over: Record<string, unknown> = {}) => ({
  id: `ep-${uid()}`, user_id, session_id: null, stripe_payment_intent_id: `pi_${uid()}`, amount_cents: 799, currency: 'eur',
  valid_until: new Date(Date.now() + 5 * H).toISOString(), status: 'active', created_at: v(0), updated_at: v(0), ...over,
})
const run = (users: any[], passes: any[], o: any = OPTS) => svc.runBackfill({ users, passes }, o, { db: firestore() })
const plan = async (fb: string) => (await firestore().doc(`users/${fb}`).get()).data()
const pass = async (fb: string, key: string) => (await firestore().doc(`users/${fb}/eventPasses/${key}`).get()).data()
const passCount = async (fb: string) => (await firestore().collection(`users/${fb}/eventPasses`).get()).size

d('entitlement backfill (Firestore emulator)', () => {
  jest.setTimeout(120_000)

  it('dry-run is the default and NEVER writes (even when everything would change)', async () => {
    const u = lu({ plan: 'wedding' }); const fb = await fbUser(u.id); const p = lp(u.id)
    const before = await plan(fb)
    const r = await run([u], [p])
    expect(r.mode).toBe('dry-run'); expect(r.plans.wouldUpdate).toBe(1); expect(r.passes.wouldCreate).toBe(1); expect(r.applied).toBeUndefined()
    expect(await plan(fb)).toEqual(before); expect(await passCount(fb)).toBe(0)
  })

  it('plans: free / pro / wedding / advance alias / unknown → free; written as source "legacy" with the DB version', async () => {
    const cases: Array<[string, string]> = [['free', 'free'], ['pro', 'pro'], ['wedding', 'wedding'], ['advance', 'wedding'], ['club', 'wedding'], ['platinum', 'free'], ['', 'free']]
    for (const [legacyPlan, expected] of cases) {
      const u = lu({ plan: legacyPlan }); const fb = await fbUser(u.id)
      await run([u], [], APPLY)
      const d1 = await plan(fb)
      expect(d1.plan).toEqual({ tier: expected, source: 'legacy' }); expect(d1.planSourceUpdatedAt.nanoseconds).toBe(100001000)
    }
  })

  it('identity: mapped through legacySupabaseId; UNMAPPED users write nothing; AMBIGUOUS mapping blocks --apply', async () => {
    const mapped = lu({ plan: 'pro' }), unmapped = lu({ plan: 'wedding' }), amb = lu({ plan: 'wedding' })
    const fbM = await fbUser(mapped.id); await fbUser(amb.id); await fbUser(amb.id)       // two Firebase users claim the same legacy id
    const r = await run([mapped, unmapped, amb], [lp(unmapped.id)])
    expect(r.users).toMatchObject({ selected: 3, mapped: 1, unmapped: 1, ambiguous: 1 })
    expect(r.blockers.join()).toMatch(/ambiguous/)
    await expect(run([mapped, unmapped, amb], [], APPLY)).rejects.toThrow(/ambiguous/)
    expect((await plan(fbM)).plan).toEqual({ tier: 'free', source: 'default' })           // nothing written by the refused apply
    const only = await run([mapped, unmapped], [], APPLY)                                  // without the ambiguous one the apply is allowed
    expect(only.applied!.written).toBe(1); expect((await plan(fbM)).plan.tier).toBe('pro')
  })

  it('email fallback is explicit and verified; never used by default', async () => {
    const u = lu({ plan: 'pro' }); const fb = `fb-${uid()}`
    await firestore().doc(`users/${fb}`).set({ uid: fb, email: u.email, plan: { tier: 'free', source: 'default' }, createdAt: new Date(), updatedAt: new Date() })   // no legacySupabaseId
    expect((await run([u], [])).users.unmapped).toBe(1)
    const auth = (verified: boolean) => ({ getUser: async () => ({ emailVerified: verified }) })
    expect((await svc.runBackfill({ users: [u], passes: [] }, { ...OPTS, emailFallback: true }, { db: firestore(), auth: auth(false) })).users.unmapped).toBe(1)
    const ok = await svc.runBackfill({ users: [u], passes: [] }, { ...OPTS, emailFallback: true }, { db: firestore(), auth: auth(true) })
    expect(ok.users).toMatchObject({ mapped: 1, mappedByEmail: 1, unmapped: 0 })
  })

  it('passes: global / scoped / expired / refunded, keyed by payment intent, legacySessionId kept and eventId left null', async () => {
    const u = lu({ plan: 'free' }); const fb = await fbUser(u.id)
    const g = lp(u.id), sc = lp(u.id, { session_id: 'sess-legacy-1' }), ex = lp(u.id, { status: 'expired', valid_until: new Date(Date.now() - H).toISOString() }), rf = lp(u.id, { status: 'refunded' })
    const noPi = lp(u.id, { stripe_payment_intent_id: null })
    const r = await run([u], [g, sc, ex, rf, noPi], APPLY)
    expect(r.passes).toMatchObject({ global: 4, scoped: 1, wouldCreate: 5 }); expect(r.passes.byStatus).toEqual({ active: 3, expired: 1, refunded: 1 })
    expect(await passCount(fb)).toBe(5)
    expect(await pass(fb, g.stripe_payment_intent_id!)).toMatchObject({ status: 'active', legacySessionId: null, eventId: null, source: 'legacy', legacySupabaseId: g.id })
    expect(await pass(fb, sc.stripe_payment_intent_id!)).toMatchObject({ legacySessionId: 'sess-legacy-1', eventId: null })
    expect((await pass(fb, rf.stripe_payment_intent_id!)).status).toBe('refunded')
    expect(await pass(fb, `legacy-${noPi.id}`)).toBeDefined()
  })

  it('duplicate payment intent on one user collapses to the best (refunded wins over active); the same key on two users is a blocker', async () => {
    const u = lu(); const fb = await fbUser(u.id); const key = `pi_${uid()}`
    const a = lp(u.id, { stripe_payment_intent_id: key }), b = lp(u.id, { stripe_payment_intent_id: key, status: 'refunded' })
    const r = await run([u], [a, b], APPLY)
    expect(r.passes.duplicatesCollapsed).toBe(1); expect(await passCount(fb)).toBe(1); expect((await pass(fb, key)).status).toBe('refunded')
    const u1 = lu(), u2 = lu(); await fbUser(u1.id); await fbUser(u2.id); const k2 = `pi_${uid()}`
    const bad = await run([u1, u2], [lp(u1.id, { stripe_payment_intent_id: k2 }), lp(u2.id, { stripe_payment_intent_id: k2 })])
    expect(bad.blockers.join()).toMatch(/different users/)
    await expect(run([u1, u2], [lp(u1.id, { stripe_payment_intent_id: k2 }), lp(u2.id, { stripe_payment_intent_id: k2 })], APPLY)).rejects.toThrow(/different users/)
  })

  it('duplicate users in the input block --apply', async () => {
    const u = lu(); await fbUser(u.id)
    const r = await run([u, { ...u }], [])
    expect(r.users.duplicates).toBe(1); await expect(run([u, { ...u }], [], APPLY)).rejects.toThrow(/duplicate/)
  })

  it('a stripe-sourced plan is NEVER overwritten (protected), and its passes are still backfilled', async () => {
    const u = lu({ plan: 'free' }); const fb = await fbUser(u.id, { tier: 'wedding', source: 'stripe' })
    const r = await run([u], [lp(u.id)], APPLY)
    expect(r.plans.protectedStripe).toBe(1); expect((await plan(fb)).plan).toEqual({ tier: 'wedding', source: 'stripe' }); expect(await passCount(fb)).toBe(1)
  })

  it('a hand-set (unversioned) legacy plan is not downgraded unless explicitly allowed', async () => {
    const u = lu({ plan: 'free' }); const fb = await fbUser(u.id, { tier: 'wedding', source: 'legacy' })     // like the real owner document
    const r = await run([u], [], APPLY)
    expect(r.plans.protectedDowngrade).toBe(1); expect((await plan(fb)).plan.tier).toBe('wedding')
    await run([u], [], { ...APPLY, allowUnversionedDowngrade: true }); expect((await plan(fb)).plan.tier).toBe('free')
  })

  it('same value is a no-op (even for the hand-set owner doc: only the version is added once), replay → 0 changes', async () => {
    const u = lu({ plan: 'wedding' }); const fb = await fbUser(u.id, { tier: 'wedding', source: 'legacy' }); const p = lp(u.id)
    const first = await run([u], [p], APPLY)
    expect(first.applied!.written).toBe(2)                                                 // pass created + version added to the plan
    const stamp = (await plan(fb)).updatedAt
    const again = await run([u], [p], APPLY)
    expect(again.applied!.written).toBe(0); expect(again.plans.wouldNoop).toBe(1); expect(again.passes.wouldNoop).toBe(1)
    expect((await plan(fb)).updatedAt.isEqual(stamp)).toBe(true)
  })

  it('ordering: a newer legacy update applies, an older one is stale; a refund is applied even if updated_at did not move', async () => {
    const u = lu({ plan: 'pro', updated_at: v(5) }); const fb = await fbUser(u.id); const p = lp(u.id)
    await run([u], [p], APPLY)
    const newer = await run([{ ...u, plan: 'wedding', updated_at: v(9) }], [], APPLY); expect(newer.plans.wouldUpdate).toBe(1); expect((await plan(fb)).plan.tier).toBe('wedding')
    const older = await run([{ ...u, plan: 'free', updated_at: v(2) }], [], APPLY); expect(older.plans.stale).toBe(1); expect((await plan(fb)).plan.tier).toBe('wedding')
    const refund = await run([u], [{ ...p, status: 'refunded' }], APPLY)               // SAME updated_at: legacy does not bump it on refund
    expect(refund.passes.wouldUpdate).toBe(1); expect((await pass(fb, p.stripe_payment_intent_id!)).status).toBe('refunded')
    const resurrect = await run([u], [{ ...p, status: 'active', updated_at: v(99) }], APPLY)   // even a "newer" active row cannot revive a refunded pass
    expect(resurrect.passes.stale).toBe(1); expect((await pass(fb, p.stripe_payment_intent_id!)).status).toBe('refunded')
  })

  it('SAFETY GUARDS: --apply on a real project needs --yes-production; selectors (--legacy-user-id / --user-email / --limit) narrow the run', async () => {
    const a = lu({ plan: 'pro' }), b = lu({ plan: 'wedding' }); const fa = await fbUser(a.id), fbb = await fbUser(b.id)
    await expect(run([a], [], { apply: true, projectId: 'iomixo-494817' })).rejects.toThrow(/yes-production/)
    await expect(run([a], [], { apply: true, projectId: '' })).rejects.toThrow(/project id/)
    const one = await run([a, b], [], { ...APPLY, legacyUserId: b.id }); expect(one.users.selected).toBe(1)
    expect((await plan(fa)).plan.source).toBe('default'); expect((await plan(fbb)).plan.tier).toBe('wedding')
    expect((await run([a, b], [], { ...OPTS, userEmail: a.email.toUpperCase() })).users.selected).toBe(1)
    expect((await run([a, b], [], { ...OPTS, limit: 1 })).users.selected).toBe(1)
  })

  it('report is masked: no full email, no full Stripe key, no full ids', async () => {
    const u = lu({ plan: 'pro' }); await fbUser(u.id); const p = lp(u.id)
    const text = JSON.stringify(await run([u], [p]))
    for (const secret of [u.email, p.stripe_payment_intent_id!, u.id]) expect(text).not.toContain(secret)
    expect(text).toMatch(/\*\*\*/)
  })

  it('100 synthetic users with mixed passes: apply, then a complete re-run changes NOTHING', async () => {
    const tiers = ['free', 'pro', 'wedding', 'advance']
    const users = Array.from({ length: 100 }, (_, i) => lu({ plan: tiers[i % 4] }))
    await Promise.all(users.map((u) => fbUser(u.id)))
    const passes = users.flatMap((u, i) => i % 3 === 0 ? [lp(u.id), lp(u.id, { session_id: `sess-${i}`, status: i % 2 ? 'refunded' : 'active' })] : [])
    const first = await run(users, passes, APPLY)
    expect(first.users.mapped).toBe(100); expect(first.applied!.written).toBeGreaterThan(100)
    const second = await run(users, passes, APPLY)
    expect(second.applied!.written).toBe(0)
    expect(second.plans).toMatchObject({ wouldUpdate: 0, wouldNoop: 100 }); expect(second.passes).toMatchObject({ wouldCreate: 0, wouldUpdate: 0, wouldNoop: passes.length })
    const dry = await run(users, passes); expect(dry.plans.wouldUpdate + dry.passes.wouldCreate + dry.passes.wouldUpdate).toBe(0)
  })

  it('ROLLBACK: restores only what the backfill wrote, deletes only created passes, skips documents changed since', async () => {
    const u = lu({ plan: 'wedding' }); const fb = await fbUser(u.id, { tier: 'pro', source: 'default' }); const p1 = lp(u.id), p2 = lp(u.id)
    const unrelated = `pi_manual_${uid()}`
    await firestore().doc(`users/${fb}/eventPasses/${unrelated}`).set({ status: 'active', source: 'manual', validUntil: new Date(Date.now() + H) })      // not ours
    let pre: any[] = []
    const r = await svc.runBackfill({ users: [u], passes: [p1, p2] as any }, APPLY, { db: firestore(), onBeforeApply: async (x) => { pre = x } })
    expect(pre).toHaveLength(3); expect(pre.filter((x) => x.before === null)).toHaveLength(2)         // pre-image was handed over BEFORE any write
    expect((await plan(fb)).plan).toEqual({ tier: 'wedding', source: 'legacy' })
    // something touches p2 after the backfill → rollback must leave it alone
    await firestore().doc(`users/${fb}/eventPasses/${p2.stripe_payment_intent_id}`).update({ status: 'refunded' })
    const dry = await svc.runRollback(firestore(), { entries: r.rollbackEntries! }, { apply: false, projectId: 'demo-iomixo' })
    expect(dry).toEqual({ restored: 1, deleted: 1, skippedChanged: 1 }); expect((await plan(fb)).plan.tier).toBe('wedding')       // dry-run changed nothing
    await expect(svc.runRollback(firestore(), { entries: r.rollbackEntries! }, { apply: true, projectId: 'iomixo-494817' })).rejects.toThrow(/yes-production/)
    const res = await svc.runRollback(firestore(), { entries: r.rollbackEntries! }, { apply: true, projectId: 'demo-iomixo' })
    expect(res).toEqual({ restored: 1, deleted: 1, skippedChanged: 1 })
    const after = await plan(fb)
    expect(after.plan).toEqual({ tier: 'pro', source: 'default' }); expect(after.planSourceUpdatedAt).toBeUndefined()
    expect(await pass(fb, p1.stripe_payment_intent_id!)).toBeUndefined()                  // created by us → deleted
    expect((await pass(fb, p2.stripe_payment_intent_id!)).status).toBe('refunded')        // changed since → untouched
    expect((await pass(fb, unrelated)).source).toBe('manual')                             // never ours → untouched
  })

  it('pre-existing pass docs: a rollback restores their previous content', async () => {
    const u = lu({ plan: 'free' }); const fb = await fbUser(u.id); const p = lp(u.id)
    const key = p.stripe_payment_intent_id!
    await run([u], [p], APPLY)
    const r = await run([u], [{ ...p, status: 'expired', valid_until: new Date(Date.now() - H).toISOString() }], APPLY)
    expect((await pass(fb, key)).status).toBe('expired')
    await svc.runRollback(firestore(), { entries: r.rollbackEntries! }, { apply: true, projectId: 'demo-iomixo' })
    expect((await pass(fb, key)).status).toBe('active')
  })
})
