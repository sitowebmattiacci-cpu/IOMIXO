import { inventorySnapshot, maskEmail, maskStripe, maskId } from '../entitlementBackfill'

const U = (id: string, over: Record<string, unknown> = {}) => ({ id, email: `${id}@example.com`, plan: 'free', stripe_customer_id: null, created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-02T00:00:00+00:00', ...over })
const P = (id: string, user_id: string, over: Record<string, unknown> = {}) => ({ id, user_id, session_id: null, stripe_payment_intent_id: `pi_${id}`, amount_cents: 799, currency: 'eur',
  valid_until: '2099-01-01T00:00:00+00:00', status: 'active', created_at: '2026-01-01T00:00:00+00:00', updated_at: '2026-01-01T00:00:00+00:00', ...over })

describe('inventorySnapshot (pure statistics of an exported snapshot)', () => {
  it('counts plans (raw + normalized), unknown values, duplicates and missing fields', () => {
    const inv = inventorySnapshot([U('a', { plan: 'advance' }), U('b', { plan: 'pro' }), U('c', { plan: 'platinum' }), U('d', { plan: null }), U('e', { email: 'A@x.com' }), U('f', { email: 'a@X.com' }),
      U('a'), U('g', { updated_at: null }), U('h', { created_at: 'nope', updated_at: null }), U('i', { stripe_customer_id: 'cus_1' })] as any, [])
    expect(inv.users).toMatchObject({ total: 10, unknownPlanValues: 2, duplicateIds: 1, duplicateEmails: 2, missingUpdatedAt: 2, invalidTimestamps: 1, withStripeCustomer: 1 })
    expect(inv.users.planRaw).toMatchObject({ advance: 1, pro: 1, platinum: 1, '∅': 1 }); expect(inv.users.planNormalized).toMatchObject({ wedding: 1, pro: 1 })
  })
  it('counts pass states, scope, anomalies and per-user distribution', () => {
    const users = [U('u1'), U('u2'), U('u3')]
    const passes = [P('p1', 'u1'), P('p2', 'u1', { session_id: 's1', status: 'refunded' }), P('p3', 'u1', { status: 'expired' }), P('p4', 'u2', { status: 'active', valid_until: '2020-01-01T00:00:00+00:00' }),
      P('p5', 'u2', { stripe_payment_intent_id: null }), P('p6', 'u2', { amount_cents: 0, stripe_payment_intent_id: 'cs_free' }), P('p7', 'u2', { stripe_payment_intent_id: 'cs_free' }),
      P('p8', 'u3', { stripe_payment_intent_id: 'pi_p1' }), P('p9', 'ghost'), P('p10', 'u3', { status: 'weird', updated_at: null, valid_until: 'x' })] as any
    const inv = inventorySnapshot(users as any, passes)
    expect(inv.passes).toMatchObject({ total: 10, global: 9, scoped: 1, unknownStatus: 1, activeButPastValidUntil: 1, withoutPaymentKey: 1, zeroEuro: 1, duplicateKeysSameUser: 1,
      keyCollisionsAcrossUsers: 1, usersWithPasses: 4, usersWithMultiplePasses: 3, maxPassesPerUser: 4, orphanPasses: 1, missingUpdatedAt: 1, invalidTimestamps: 1 })
    expect(inv.passes.byStatus).toMatchObject({ active: 7, refunded: 1, expired: 1, weird: 1 })
  })
  it('the inventory itself carries no identifier', () => {
    const txt = JSON.stringify(inventorySnapshot([U('secret-user-id', { email: 'very.private@example.com', stripe_customer_id: 'cus_SECRET' })] as any, [P('p1', 'secret-user-id', { stripe_payment_intent_id: 'pi_SECRETKEY' })] as any))
    for (const s of ['secret-user-id', 'very.private', 'cus_SECRET', 'pi_SECRETKEY']) expect(txt).not.toContain(s)
  })
  it('masks', () => {
    expect(maskEmail('enrico.mattiacci@example.com')).toBe('e***@e***.com'); expect(maskStripe('pi_3Pabcdefghijkl1234')).toBe('pi_…1234'); expect(maskId('f9aeeef2-ec4b-4e52-8024-94e31626a9f5')).toBe('f9ae…a9f5')
  })
})
