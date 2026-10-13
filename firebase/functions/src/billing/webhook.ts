import Stripe from 'stripe'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { StripeApi } from './stripeApi'
import { priceInfo, UnknownPriceError, type PriceTable } from './prices'
import { resolveUid, UnresolvedAccountError } from './accounts'
import type { PlanTier } from '../entitlements/plans'

/**
 * Stripe webhook → Firestore. Source of truth for plans/passes from now on (plan.source = 'stripe').
 *
 *  1. The signature is verified on the RAW body with this endpoint's own secret (STRIPE_WEBHOOK_SECRET). Invalid → 400, nothing is read or written.
 *  2. Idempotency: stripeEvents/{event.id} is claimed in a transaction (status processing → processed). A duplicate of a processed event is acknowledged (200)
 *     without side effects; a concurrent delivery is refused (409) so Stripe retries later; a previously failed / abandoned event is re-run.
 *  3. A handler failure is NEVER acknowledged: the event is marked failed and the response is 500, so Stripe retries (unlike the legacy backend, which swallowed errors).
 *  4. Unknown price → UnknownPriceError (explicit failure). No fallback to any plan. Unresolvable account → UnresolvedAccountError. Both are 500 + recorded.
 *  5. Every write is create-only or monotonic (a pass never un-refunds, a subscription doc ignores an older event), so replays and reordering are harmless.
 *  6. Event Pass validity = payment time (the event's `created`) + 24 h, never "now": a late retry or a replay cannot grant a fresh 24 h.
 * Stored in stripeEvents: type, ids, status, attempts, error CODE. No payload, no e-mail, no card data.
 */
export const EVENT_PASS_HOURS = 24
export const PLAN_GRACE_DAYS = 3                      // plan.validUntil = current period end + grace, so a late renewal webhook does not cut a paying user off
const LOCK_MS = 5 * 60_000
const LIVE_STATUSES = ['active', 'trialing']
const RANK: Record<Exclude<PlanTier, 'free'>, number> = { pro: 1, wedding: 2 }

const ts = (sec?: number | null): Timestamp | null => (typeof sec === 'number' ? Timestamp.fromMillis(sec * 1000) : null)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null)
const safeId = (v: string) => v.replace(/\//g, '_')

export interface WebhookDeps { db: Firestore; stripe: StripeApi; prices: PriceTable; now?: () => Date }
export interface WebhookResult { status: number; body: Record<string, unknown> }

// ── entry point ──────────────────────────────────────────────────────────────────────────────────
export async function handleStripeWebhook(deps: WebhookDeps, input: { rawBody: Buffer | string | undefined; signature: string | undefined; secret: string }): Promise<WebhookResult> {
  let event: Stripe.Event
  try {
    if (!input.rawBody || !input.signature) throw new Error('missing')
    event = Stripe.webhooks.constructEvent(input.rawBody, input.signature, input.secret)
  } catch {
    return { status: 400, body: { error: 'invalid_signature' } }
  }
  const now = (deps.now ?? (() => new Date()))()
  const ref = deps.db.doc(`stripeEvents/${safeId(event.id)}`)

  // claim
  const claim = await deps.db.runTransaction(async (tx) => {
    const s = await tx.get(ref), d = s.data()
    if (s.exists && d!.status === 'processed') return 'duplicate' as const
    if (s.exists && d!.status === 'processing' && (d!.lockedUntil as Timestamp).toMillis() > now.getTime()) return 'busy' as const
    tx.set(ref, {
      type: event.type, created: event.created, livemode: event.livemode, status: 'processing', attempts: (s.exists ? (d!.attempts as number) : 0) + 1,
      lockedUntil: Timestamp.fromMillis(now.getTime() + LOCK_MS), receivedAt: s.exists ? d!.receivedAt : Timestamp.fromDate(now), error: FieldValue.delete(),
    }, { merge: true })
    return 'claimed' as const
  })
  if (claim === 'duplicate') return { status: 200, body: { received: true, duplicate: true } }
  if (claim === 'busy') return { status: 409, body: { error: 'processing' } }

  try {
    await dispatch(deps, event, now)
    await ref.update({ status: 'processed', processedAt: Timestamp.fromDate(now), lockedUntil: FieldValue.delete() })
    return { status: 200, body: { received: true } }
  } catch (e) {
    const code = e instanceof UnknownPriceError ? 'unknown_price' : e instanceof UnresolvedAccountError ? 'unresolved_account' : 'handler_error'
    logger.error('stripe_webhook_failed', { type: event.type, eventId: event.id, code, message: code === 'handler_error' ? (e as Error).message : undefined })
    await ref.update({ status: 'failed', error: code, failedAt: Timestamp.fromDate(now), lockedUntil: FieldValue.delete() }).catch(() => {})
    return { status: 500, body: { error: code } }
  }
}

async function dispatch(deps: WebhookDeps, event: Stripe.Event, now: Date): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session
      if (s.mode === 'subscription') { if (event.type === 'checkout.session.completed') await onSubscriptionCheckout(deps, event, s, now) }
      else if (s.mode === 'payment') await onEventPassCheckout(deps, event, s, now)
      return
    }
    case 'checkout.session.async_payment_failed':
    case 'payment_intent.payment_failed':
      logger.warn('stripe_payment_failed', { type: event.type })       // no access is ever granted on a failed payment; nothing to write
      return
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscriptionChange(deps, event, event.data.object as Stripe.Subscription, now)
    case 'invoice.paid':
    case 'invoice.payment_succeeded':
      return onInvoice(deps, event, event.data.object as Stripe.Invoice, 'succeeded')
    case 'invoice.payment_failed':
      return onInvoice(deps, event, event.data.object as Stripe.Invoice, 'failed')
    case 'charge.refunded':
      return onRefund(deps, event.data.object as Stripe.Charge, now)
    default:
      return                                                              // not subscribed / not relevant: acknowledged
  }
}

// ── subscriptions ────────────────────────────────────────────────────────────────────────────────
async function upsertSubscription(deps: WebhookDeps, uid: string, sub: Stripe.Subscription, eventCreated: number, now: Date): Promise<'live' | 'other'> {
  const live = LIVE_STATUSES.includes(sub.status)
  const priceId = sub.items.data[0]?.price.id
  // strict for a live subscription (an unknown price must not silently grant or deny a plan); a finished one may carry a retired price
  const tier = live ? priceInfo(deps.prices, priceId).tier : deps.prices.get(priceId ?? '')?.tier ?? null
  const ref = deps.db.doc(`users/${uid}/subscriptions/${safeId(sub.id)}`)
  await deps.db.runTransaction(async (tx) => {
    const cur = await tx.get(ref)
    if (cur.exists && typeof cur.data()!.lastEventCreated === 'number' && cur.data()!.lastEventCreated > eventCreated) return          // an older event never overwrites a newer state
    tx.set(ref, {
      stripeSubscriptionId: sub.id, stripeCustomerId: str(sub.customer), priceId: priceId ?? null, tier, status: sub.status,
      currentPeriodStart: ts(sub.current_period_start), currentPeriodEnd: ts(sub.current_period_end), cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      canceledAt: ts(sub.canceled_at), trialStart: ts(sub.trial_start), trialEnd: ts(sub.trial_end),
      historical: false, stale: false, source: 'stripe', lastEventCreated: eventCreated, uid, updatedAt: Timestamp.fromDate(now),
      ...(cur.exists ? {} : { createdAt: ts(sub.created) ?? Timestamp.fromDate(now) }),
    }, { merge: true })
  })
  return live ? 'live' : 'other'
}

/** Plan = the best subscription STILL live in Stripe (read from the API, so event order cannot matter). */
async function recomputePlan(deps: WebhookDeps, uid: string, customerId: string | null, now: Date) {
  let best: { tier: 'pro' | 'wedding'; end: number } | null = null
  if (customerId) {
    const subs = await deps.stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    for (const s of subs.data) {
      if (!LIVE_STATUSES.includes(s.status)) continue
      const tier = priceInfo(deps.prices, s.items.data[0]?.price.id).tier!
      if (!best || RANK[tier] >= RANK[best.tier]) best = { tier, end: s.current_period_end }
    }
  }
  const ref = deps.db.doc(`users/${uid}`)
  await deps.db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) throw new UnresolvedAccountError()
    tx.update(ref, {
      plan: best ? { tier: best.tier, source: 'stripe', validUntil: Timestamp.fromMillis((best.end + PLAN_GRACE_DAYS * 86400) * 1000) } : { tier: 'free', source: 'stripe' },
      planSourceUpdatedAt: Timestamp.fromDate(now),
    })
  })
}

async function onSubscriptionCheckout(deps: WebhookDeps, event: Stripe.Event, s: Stripe.Checkout.Session, now: Date) {
  if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return        // never grant before Stripe collected payment (trial → no_payment_required)
  const customerId = str(s.customer)
  const uid = await resolveUid(deps.db, { firebaseUid: s.metadata?.firebaseUid, customerId, legacyUserId: s.metadata?.legacySupabaseId ?? s.metadata?.user_id })
  const subId = str(s.subscription)
  if (!subId) throw new Error('checkout_without_subscription')
  const sub = await deps.stripe.subscriptions.retrieve(subId)
  await upsertSubscription(deps, uid, sub, event.created, now)
  if (customerId) {
    // a plan switch: keep only the newest subscription, so nobody is billed for two plans
    const all = await deps.stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
    for (const o of all.data) if (o.id !== sub.id && ['active', 'trialing', 'past_due'].includes(o.status)) {
      try { await deps.stripe.subscriptions.cancel(o.id) } catch (e) { logger.warn('stripe_cancel_superseded_failed', { message: (e as Error).message }) }
    }
  }
  await recomputePlan(deps, uid, customerId, now)
}

async function onSubscriptionChange(deps: WebhookDeps, event: Stripe.Event, sub: Stripe.Subscription, now: Date) {
  const customerId = str(sub.customer)
  const uid = await resolveUid(deps.db, { firebaseUid: sub.metadata?.firebaseUid, customerId, legacyUserId: sub.metadata?.legacySupabaseId ?? sub.metadata?.user_id })
  await upsertSubscription(deps, uid, sub, event.created, now)
  await recomputePlan(deps, uid, customerId, now)
}

// ── payments ledger ──────────────────────────────────────────────────────────────────────────────
async function createOnce(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) {
  try { await ref.create(data); return true } catch (e) { if ((e as { code?: number }).code === 6) return false; throw e }       // 6 = ALREADY_EXISTS
}

async function onInvoice(deps: WebhookDeps, event: Stripe.Event, inv: Stripe.Invoice, outcome: 'succeeded' | 'failed') {
  const customerId = str(inv.customer)
  const uid = await resolveUid(deps.db, { customerId, firebaseUid: inv.subscription_details?.metadata?.firebaseUid, legacyUserId: inv.subscription_details?.metadata?.user_id })
  const pi = str(inv.payment_intent)
  const id = outcome === 'succeeded' ? (pi ?? `in_${safeId(inv.id!)}`) : `in_${safeId(inv.id!)}`
  await createOnce(deps.db.doc(`users/${uid}/payments/${id}`), {
    stripePaymentIntentId: pi, stripeInvoiceId: inv.id, stripeCheckoutSessionId: null, amountCents: outcome === 'succeeded' ? inv.amount_paid : inv.amount_due,
    currency: inv.currency, status: outcome, description: 'Subscription payment', kind: 'subscription', historical: false, source: 'stripe', uid,
    createdAt: ts(event.created), updatedAt: ts(event.created),
  })
  const subId = str(inv.subscription)
  if (outcome === 'failed' && subId) {
    const sref = deps.db.doc(`users/${uid}/subscriptions/${safeId(subId)}`)
    if ((await sref.get()).exists) await sref.update({ lastPaymentFailedAt: ts(event.created) })
  }
}

// ── Event Pass ───────────────────────────────────────────────────────────────────────────────────
async function onEventPassCheckout(deps: WebhookDeps, event: Stripe.Event, s: Stripe.Checkout.Session, now: Date) {
  if (s.status !== 'complete' || (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required')) return        // declined / async-pending: no access
  // The purchased price must be a known Event Pass price (explicit error otherwise).
  const items = await deps.stripe.checkout.sessions.listLineItems(s.id, { limit: 10 })
  const infos = items.data.map((i) => priceInfo(deps.prices, i.price?.id))
  if (!infos.some((i) => i.product === 'event_pass')) throw new UnknownPriceError(items.data[0]?.price?.id)
  const customerId = str(s.customer)
  const uid = await resolveUid(deps.db, { firebaseUid: s.metadata?.firebaseUid, customerId, legacyUserId: s.metadata?.legacySupabaseId ?? s.metadata?.user_id })

  // A 0 € checkout (100 % coupon) has no payment intent: the session id is the dedup key (and can never collide with a real charge).
  const key = safeId(str(s.payment_intent) ?? s.id)
  const paidAtMs = event.created * 1000
  const validUntilMs = paidAtMs + EVENT_PASS_HOURS * 3600_000
  let eventId: string | null = null
  if (s.metadata?.eventId) {
    const ev = await deps.db.doc(`events/${s.metadata.eventId}`).get()
    if (ev.exists && ev.data()!.ownerUid === uid) eventId = s.metadata.eventId
  }
  const created = await createOnce(deps.db.doc(`users/${uid}/eventPasses/${key}`), {
    status: validUntilMs > now.getTime() ? 'active' : 'expired', validUntil: Timestamp.fromMillis(validUntilMs), legacySessionId: s.metadata?.session_id ?? null, eventId,
    source: 'stripe', stripePaymentIntentId: str(s.payment_intent), stripeCheckoutSessionId: s.id, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'eur',
    sourceUpdatedAt: ts(event.created), createdAt: ts(event.created),
  })
  if (created) {
    await createOnce(deps.db.doc(`users/${uid}/payments/${key}`), {
      stripePaymentIntentId: str(s.payment_intent), stripeCheckoutSessionId: s.id, stripeInvoiceId: null, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'eur',
      status: 'succeeded', description: `Event Pass 24H — valido fino al ${new Date(validUntilMs).toISOString()}`, kind: 'event_pass', historical: false, source: 'stripe', uid,
      createdAt: ts(event.created), updatedAt: ts(event.created),
    })
  }
}

async function onRefund(deps: WebhookDeps, charge: Stripe.Charge, now: Date) {
  const pi = str(charge.payment_intent)
  if (!pi) return
  const uid = await resolveUid(deps.db, { customerId: str(charge.customer), firebaseUid: charge.metadata?.firebaseUid })
  const key = safeId(pi)
  const pass = deps.db.doc(`users/${uid}/eventPasses/${key}`), pay = deps.db.doc(`users/${uid}/payments/${key}`)
  await deps.db.runTransaction(async (tx) => {
    const [p, y] = await Promise.all([tx.get(pass), tx.get(pay)])
    if (p.exists && p.data()!.status !== 'refunded') tx.update(pass, { status: 'refunded', refundedAt: Timestamp.fromDate(now) })          // revoke any non-refunded pass (full or partial, as before)
    if (y.exists && y.data()!.status !== 'refunded') tx.update(pay, { status: 'refunded', refundedAt: Timestamp.fromDate(now) })
  })
}
