/** Emulator-only (npm run test:firebase): legacy billing history → Firestore (customer mapping, subscriptions, payments): audit only, never an entitlement. */
export {}
const emu = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
const d = emu ? describe : describe.skip
const svc: typeof import('../billingBackfill') = emu ? require('../billingBackfill') : (undefined as never)
const { firestore } = emu ? require('../../lib/firebaseAdmin') : ({} as any)

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const OPTS = { apply: false, projectId: 'demo-iomixo' }, APPLY = { apply: true, projectId: 'demo-iomixo' }
const run = (snap: any, o: any = OPTS) => svc.runBillingBackfill(snap, o, { db: firestore() })
const NOW = '2026-10-13T00:00:00+00:00'

async function mkUser(legacy: string, over: Record<string, unknown> = {}) {
  const ref = firestore().collection('users').doc('u' + uid().replace(/[^A-Za-z0-9]/g, ''))
  await ref.set({ uid: ref.id, email: 'a@b.c', plan: { tier: 'wedding', source: 'legacy' }, legacySupabaseId: legacy, createdAt: new Date(), updatedAt: new Date(), ...over })
  return ref
}
const user = (id: string, cust: string | null, plan = 'wedding') => ({ id, email: 'x@y.z', plan, stripe_customer_id: cust })
const sub = (user_id: string, cust: string, over: Record<string, unknown> = {}) => ({
  id: 'row-' + uid(), user_id, stripe_subscription_id: 'sub_' + uid().replace(/[^A-Za-z0-9]/g, ''), stripe_customer_id: cust, plan: 'wedding', status: 'trialing',
  current_period_start: '2026-06-16T12:42:19+00:00', current_period_end: '2026-06-23T12:42:19+00:00', cancel_at_period_end: false, canceled_at: null, created_at: '2026-06-16T12:42:21.813619+00:00', ...over,
})
const pay = (user_id: string, over: Record<string, unknown> = {}) => ({ id: 'pay-' + uid(), user_id, stripe_payment_intent_id: 'pi_' + uid().replace(/[^A-Za-z0-9]/g, ''), amount_cents: 799, currency: 'eur', status: 'succeeded', description: 'Event Pass 24H — valido fino al x', created_at: '2026-06-10T10:19:45.775939+00:00', ...over })
const snapshot = (o: Record<string, unknown>) => ({ generatedAt: NOW, users: [], subscriptions: [], payments: [], eventPasses: [], ...o })

d('billing backfill (Firestore emulator)', () => {
  jest.setTimeout(120_000)

  it('dry-run never writes; apply writes history ONLY (plan untouched, no entitlement); rerun is a no-op; stale legacy status is flagged', async () => {
    const lid = 'l-' + uid(), cust = 'cus_' + uid().replace(/[^A-Za-z0-9]/g, ''); const u = await mkUser(lid)
    const s1 = sub(lid, cust), p1 = pay(lid), p2 = pay(lid, { stripe_payment_intent_id: null, amount_cents: 0, description: 'Subscription payment — Tue' }), p3 = pay(lid, { stripe_payment_intent_id: 'cs_live_' + uid().replace(/[^A-Za-z0-9]/g, ''), amount_cents: 0 })
    const snap = snapshot({ users: [user(lid, cust)], subscriptions: [s1], payments: [p1, p2, p3] })
    const before = (await u.get()).data()
    const dry = await run(snap)
    expect(dry.mode).toBe('dry-run')
    expect(dry.customer).toMatchObject({ selected: 1, wouldSet: 1, noop: 0, drift: 0 }); expect(dry.reverseMapping).toMatchObject({ wouldCreate: 1, noop: 0, drift: 0 })
    expect(dry.subscriptions).toMatchObject({ selected: 1, wouldCreate: 1, stale: 1, liveStatusInLegacy: 1 }); expect(dry.payments).toMatchObject({ selected: 3, wouldCreate: 3, byKind: { event_pass: 2, subscription: 1 } })
    expect((await firestore().collection('stripeCustomers').doc(cust).get()).exists).toBe(false); expect((await u.get()).data()).toEqual(before)

    const r = await run(snap, APPLY)
    expect(r.applied).toEqual({ written: 6, skipped: 0 })
    const after = (await u.get()).data()
    expect(after.stripeCustomerId).toBe(cust); expect(after.plan).toEqual(before.plan); expect(after.updatedAt).toEqual(before.updatedAt)
    expect((await firestore().collection('stripeCustomers').doc(cust).get()).data()).toMatchObject({ uid: u.id, legacySupabaseId: lid })
    const sd = (await u.collection('subscriptions').doc(s1.stripe_subscription_id).get()).data()
    expect(sd).toMatchObject({ tier: 'wedding', legacyStatus: 'trialing', historical: true, stale: true, stripeCustomerId: cust }); expect(sd.status).toBeUndefined()
    expect((await u.collection('payments').doc(p1.stripe_payment_intent_id).get()).data()).toMatchObject({ stripePaymentIntentId: p1.stripe_payment_intent_id, kind: 'event_pass', historical: true })
    expect((await u.collection('payments').doc(`legacy-${p2.id}`).get()).data()).toMatchObject({ stripePaymentIntentId: null, kind: 'subscription', legacySupabaseId: p2.id })
    expect((await u.collection('payments').doc(p3.stripe_payment_intent_id).get()).data()).toMatchObject({ stripePaymentIntentId: null, stripeCheckoutSessionId: p3.stripe_payment_intent_id })
    expect((await u.collection('eventPasses').get()).size).toBe(0)                    // nothing written there

    const again = await run(snap, APPLY)
    expect(again.applied).toEqual({ written: 0, skipped: 0 }); expect(again.customer.noop).toBe(1); expect(again.subscriptions.noop).toBe(1); expect(again.payments.noop).toBe(3); expect(again.reverseMapping.noop).toBe(1)
  })

  it('an incoherent user (users.stripe_customer_id ≠ the subscriptions\' customer) is reported and NOT migrated; existing data is never overwritten (drift)', async () => {
    const bad = 'l-' + uid(), ok = 'l-' + uid(), c1 = 'cus_A' + uid().replace(/[^A-Za-z0-9]/g, ''), c2 = 'cus_B' + uid().replace(/[^A-Za-z0-9]/g, ''), c3 = 'cus_C' + uid().replace(/[^A-Za-z0-9]/g, '')
    const ub = await mkUser(bad), uo = await mkUser(ok, { stripeCustomerId: 'cus_other' })
    const snap = snapshot({
      users: [user(bad, c1), user(ok, c3)],
      subscriptions: [sub(bad, c2, { status: 'active' }), sub(bad, c2, { status: 'active', plan: 'pro' }), sub(ok, c3)], payments: [pay(bad), pay(ok)],
    })
    const r = await run(snap)
    expect(r.scope).toMatchObject({ mapped: 2, skippedIncoherent: 1 })
    expect(r.userIssues.find((i) => i.issues.includes('customer_mismatch'))).toMatchObject({ migrated: false })
    expect(r.userIssues.find((i) => i.issues.includes('multiple_live_subscriptions'))).toBeTruthy()
    expect(r.customer.drift).toBe(1); expect(r.blockers.join(' ')).toMatch(/differs from the legacy customer/)
    await expect(run(snap, APPLY)).rejects.toThrow(/refused/)
    expect((await ub.collection('subscriptions').get()).size).toBe(0); expect((await uo.get()).data().stripeCustomerId).toBe('cus_other')
  })

  it('event passes are cross-checked only (already migrated vs missing), unmapped users are skipped, a customer mapped to someone else is a conflict, guards refuse prod without --yes-production', async () => {
    const lid = 'l-' + uid(), cust = 'cus_' + uid().replace(/[^A-Za-z0-9]/g, ''); const u = await mkUser(lid)
    const pass = { id: 'ep-' + uid(), user_id: lid, stripe_payment_intent_id: 'pi_' + uid().replace(/[^A-Za-z0-9]/g, ''), status: 'active' }, pass2 = { id: 'ep-' + uid(), user_id: lid, stripe_payment_intent_id: 'pi_' + uid().replace(/[^A-Za-z0-9]/g, ''), status: 'expired' }
    await u.collection('eventPasses').doc(pass.stripe_payment_intent_id).set({ status: 'active' })
    await firestore().collection('stripeCustomers').doc(cust).set({ uid: 'someone-else', legacySupabaseId: 'x' })
    const r = await run(snapshot({ users: [user(lid, cust), user('ghost-' + uid(), null, 'free')], eventPasses: [pass, pass2] }))
    expect(r.eventPasses).toEqual({ inSnapshot: 2, skippedAlreadyMigrated: 1, missingInFirestore: 1, written: 0 })
    expect(r.scope.unmapped).toBe(1); expect(r.reverseMapping.conflicts).toBe(1); expect(r.blockers.join(' ')).toMatch(/different account/)
    await expect(svc.runBillingBackfill(snapshot({}) as any, { apply: true, projectId: 'iomixo-494817' }, { db: firestore() })).rejects.toThrow(/yes-production/)
  })

  it('rollback removes only what the run created; the customer field is cleared only while unchanged; the plan is never touched', async () => {
    const lid = 'l-' + uid(), cust = 'cus_' + uid().replace(/[^A-Za-z0-9]/g, ''); const u = await mkUser(lid)
    const s = sub(lid, cust), p = pay(lid)
    const r = await run(snapshot({ users: [user(lid, cust)], subscriptions: [s], payments: [p] }), APPLY)
    const dry = await svc.runBillingRollback(firestore(), r.entries!, OPTS)
    expect(dry).toEqual({ removed: 3, cleared: 1, skippedChanged: 0 }); expect((await u.get()).data().stripeCustomerId).toBe(cust)
    await u.collection('payments').doc(p.stripe_payment_intent_id).update({ backfilled: false })     // touched since
    const res = await svc.runBillingRollback(firestore(), r.entries!, APPLY)
    expect(res).toEqual({ removed: 2, cleared: 1, skippedChanged: 1 })
    expect((await u.get()).data().stripeCustomerId).toBeUndefined(); expect((await u.get()).data().plan).toEqual({ tier: 'wedding', source: 'legacy' })
    expect((await u.collection('payments').doc(p.stripe_payment_intent_id).get()).exists).toBe(true)
  })
})
