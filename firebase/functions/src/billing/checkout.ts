import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { isStripeError, type StripeApi } from './stripeApi'
import { checkoutPrice, type PriceTable } from './prices'

/**
 * createCheckoutSession / createPortalSession (owner callables). Identity = verified token only. The client sends a price id, an optional trial flag and an
 * optional Firebase event id; everything else (customer, mode, URLs, metadata, payment methods, trial length) is decided here.
 */
const fail = (code: FunctionsErrorCode, reason: string): never => { throw new HttpsError(code, reason, { reason }) }

/** baseUrl = IOMIXO (DJ accounts); coupleBaseUrl = MIOLOVE, set at go-live (MIOLOVE_BASE_URL). Unset → every account keeps returning to baseUrl. */
export interface BillingConfig { baseUrl: string; coupleBaseUrl?: string }
/** Return origin by the account's role (server-side data, never client input): Sposi → MIOLOVE, everyone else → IOMIXO. */
const returnBase = (cfg: BillingConfig, accountType: unknown): { base: string; couple: boolean } => {
  const couple = accountType === 'couple' && !!cfg.coupleBaseUrl
  return { base: (couple ? cfg.coupleBaseUrl! : cfg.baseUrl).replace(/\/+$/, ''), couple }
}
export interface AuthLike { uid: string; token: { email?: string; firebase?: { sign_in_provider?: string } } }
const account = (auth: AuthLike | undefined): AuthLike => {
  if (!auth?.uid || auth.token.firebase?.sign_in_provider === 'anonymous') return fail('unauthenticated', 'account_required')
  return auth
}

export interface CheckoutInput { priceId: string; trial: boolean; eventId: string | null }
export function parseCheckoutInput(d: unknown): CheckoutInput {
  const o = (d ?? {}) as Record<string, unknown>
  if (typeof o.priceId !== 'string' || !/^price_[A-Za-z0-9]{8,120}$/.test(o.priceId)) return fail('invalid-argument', 'invalid_payload')
  if (o.trial !== undefined && typeof o.trial !== 'boolean') return fail('invalid-argument', 'invalid_payload')
  if (o.eventId !== undefined && o.eventId !== null && (typeof o.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(o.eventId))) return fail('invalid-argument', 'invalid_payload')
  return { priceId: o.priceId, trial: o.trial === true, eventId: (o.eventId as string | undefined) ?? null }
}

/** The Stripe customer of this account, guaranteed to exist in the CURRENT Stripe environment (test/live); created and persisted (both mappings) when absent. */
export async function ensureCustomer(db: Firestore, stripe: StripeApi, uid: string, email: string): Promise<string> {
  const uref = db.doc(`users/${uid}`), snap = await uref.get()
  if (!snap.exists) return fail('failed-precondition', 'account_not_ready')
  const saved: unknown = snap.data()!.stripeCustomerId
  if (typeof saved === 'string' && saved) {
    try { const c = await stripe.customers.retrieve(saved); if (!c.deleted) return saved }
    catch (e) { if (!(isStripeError(e) && e.code === 'resource_missing')) throw e }       // another environment / deleted → create a fresh one
  }
  const legacy = snap.data()!.legacySupabaseId
  const created = await stripe.customers.create({ email: email || (snap.data()!.email as string | undefined), metadata: { firebaseUid: uid, ...(legacy ? { legacySupabaseId: String(legacy) } : {}) } })
  await db.runTransaction(async (tx) => {
    tx.update(uref, { stripeCustomerId: created.id })
    tx.set(db.doc(`stripeCustomers/${created.id}`), { uid, legacySupabaseId: legacy ?? null, source: 'checkout', createdAt: FieldValue.serverTimestamp() })
  })
  return created.id
}

export async function createCheckoutSession(
  db: Firestore, stripe: StripeApi, prices: PriceTable, cfg: BillingConfig, authIn: AuthLike | undefined, input: CheckoutInput,
): Promise<{ url: string }> {
  const auth = account(authIn)
  const price = checkoutPrice(prices, input.priceId)
  if (!price) return fail('invalid-argument', 'invalid_price')                                    // not in the server allow-list: never forwarded to Stripe

  const uref = db.doc(`users/${auth.uid}`), user = await uref.get()
  if (!user.exists) return fail('failed-precondition', 'account_not_ready')
  const legacyId: string | null = user.data()!.legacySupabaseId ? String(user.data()!.legacySupabaseId) : null

  // A trial: subscriptions only, and only for an account that never had a subscription (checked server-side).
  let trial = false
  if (input.trial) {
    if (price.mode !== 'subscription') return fail('invalid-argument', 'trial_not_available')
    if (!(await uref.collection('subscriptions').limit(1).get()).empty) return fail('failed-precondition', 'trial_not_available')
    trial = true
  }
  // An Event Pass may be scoped to one of the caller's own events; any other event id is refused.
  let eventId: string | null = null
  if (input.eventId) {
    if (price.product !== 'event_pass') return fail('invalid-argument', 'invalid_payload')
    const ev = await db.doc(`events/${input.eventId}`).get()
    if (!ev.exists || ev.data()!.ownerUid !== auth.uid || ev.data()!.deletedAt) return fail('not-found', 'event_not_found')
    eventId = input.eventId
  }

  const customer = await ensureCustomer(db, stripe, auth.uid, auth.token.email ?? '')
  const checkoutType = price.mode === 'payment' ? 'event_pass' : trial ? 'trial' : 'subscription'
  const metadata: Record<string, string> = { firebaseUid: auth.uid, plan: price.tier ?? 'event_pass', checkoutType, product: price.product }
  if (legacyId) metadata.legacySupabaseId = legacyId
  if (eventId) metadata.eventId = eventId

  const { base, couple } = returnBase(cfg, user.data()!.accountType)
  const params: Parameters<StripeApi['checkout']['sessions']['create']>[0] = {
    customer, mode: price.mode, line_items: [{ price: input.priceId, quantity: 1 }],
    payment_method_types: ['card', 'paypal'], allow_promotion_codes: true, metadata,
    success_url: `${base}/${couple ? 'billing' : 'dashboard'}?upgraded=true&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/billing`,
  }
  if (price.mode === 'subscription') {
    params.subscription_data = { metadata, ...(trial ? { trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}) }
    if (trial) params.payment_method_collection = 'if_required'
  } else {
    params.payment_intent_data = { metadata }
  }
  try {
    const session = await stripe.checkout.sessions.create(params)
    if (!session.url) return fail('internal', 'checkout_failed')
    return { url: session.url }
  } catch (e) {
    if (e instanceof HttpsError) throw e
    if (isStripeError(e)) return fail('failed-precondition', 'checkout_failed')                // Stripe's message is not forwarded to the client
    throw e
  }
}

export async function createPortalSession(db: Firestore, stripe: StripeApi, cfg: BillingConfig, authIn: AuthLike | undefined): Promise<{ url: string }> {
  const auth = account(authIn)
  const userData = (await db.doc(`users/${auth.uid}`).get()).data()
  const customer = userData?.stripeCustomerId
  if (typeof customer !== 'string' || !customer) return fail('failed-precondition', 'no_billing_account')
  try {
    const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${returnBase(cfg, userData?.accountType).base}/billing` })
    return { url: s.url }
  } catch (e) {
    if (isStripeError(e)) return fail('failed-precondition', 'portal_failed')
    throw e
  }
}
