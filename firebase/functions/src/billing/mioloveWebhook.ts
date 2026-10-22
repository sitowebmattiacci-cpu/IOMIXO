import Stripe from 'stripe'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { StripeApi } from './stripeApi'
import { priceInfo, UnknownPriceError, type PriceInfo, type PriceTable } from './prices'
import { eventBrandOf } from '../owner/brand'

/**
 * MIOLOVE Stripe webhook → Firestore. A SEPARATE endpoint, secret and Stripe account from IOMIXO's `stripeWebhook` (billing/webhook.ts, untouched):
 *
 *  - It is signed with the MIOLOVE webhook secret only. An IOMIXO-signed event fails verification here, and a MIOLOVE-signed one fails on the IOMIXO endpoint.
 *  - It handles ONE thing: a paid Checkout Session of the MIOLOVE album price activates ONE album (events/{eventId}.accessMode → 'activated'). Every other event type is
 *    acknowledged and ignored. It contains no path that can create an Event Pass, a subscription or an IOMIXO plan.
 *  - Authority = this verified, paid session. The metadata is only a pointer that must agree with Firestore: the buyer (metadata.firebaseUid) must be the album's owner and the
 *    album a MIOLOVE one; anything that disagrees activates NOTHING (recorded + logged for a human, acknowledged so Stripe stops retrying).
 *  - Idempotent: mioloveStripeEvents/{event.id} is claimed in a transaction; a duplicate is acknowledged with no side effect; an already activated album is left exactly as it is
 *    and the payment ledger entry is create-once. A handler failure answers 500 so Stripe retries.
 * Stored: ids, status, error CODE only (no payload, no e-mail, no card data).
 */
const LOCK_MS = 5 * 60_000
const safeId = (v: string) => v.replace(/\//g, '_')
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null)
const ts = (sec?: number | null): Timestamp | null => (typeof sec === 'number' ? Timestamp.fromMillis(sec * 1000) : null)

export interface MioloveWebhookDeps { db: Firestore; stripe: StripeApi; prices: PriceTable; now?: () => Date }
export interface MioloveWebhookResult { status: number; body: Record<string, unknown> }

export async function handleMioloveWebhook(deps: MioloveWebhookDeps, input: { rawBody: Buffer | string | undefined; signature: string | undefined; secret: string }): Promise<MioloveWebhookResult> {
  let event: Stripe.Event
  try {
    if (!input.rawBody || !input.signature || !input.secret) throw new Error('missing')
    event = Stripe.webhooks.constructEvent(input.rawBody, input.signature, input.secret)
  } catch {
    return { status: 400, body: { error: 'invalid_signature' } }
  }
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return { status: 200, body: { received: true, ignored: true } }
  const now = (deps.now ?? (() => new Date()))()
  const ref = deps.db.doc(`mioloveStripeEvents/${safeId(event.id)}`)

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
    await onCheckout(deps, event, event.data.object as Stripe.Checkout.Session)
    await ref.update({ status: 'processed', processedAt: Timestamp.fromDate(now), lockedUntil: FieldValue.delete() })
    return { status: 200, body: { received: true } }
  } catch (e) {
    const code = e instanceof UnknownPriceError ? 'unknown_price' : 'handler_error'
    logger.error('miolove_webhook_failed', { type: event.type, eventId: event.id, code, message: code === 'handler_error' ? (e as Error).message : undefined })
    await ref.update({ status: 'failed', error: code, failedAt: Timestamp.fromDate(now), lockedUntil: FieldValue.delete() }).catch(() => {})
    return { status: 500, body: { error: code } }
  }
}

async function createOnce(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) {
  try { await ref.create(data); return true } catch (e) { if ((e as { code?: number }).code === 6) return false; throw e }       // 6 = ALREADY_EXISTS
}

async function onCheckout(deps: MioloveWebhookDeps, event: Stripe.Event, s: Stripe.Checkout.Session) {
  if (s.mode !== 'payment') return                                                                                // this endpoint sells one thing: a one-time payment
  if (s.status !== 'complete' || (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required')) return        // declined / async-pending: no access
  const items = await deps.stripe.checkout.sessions.listLineItems(s.id, { limit: 10 })
  const infos: PriceInfo[] = items.data.map((i) => priceInfo(deps.prices, i.price?.id))             // an unknown price is an explicit failure (500 + recorded), never a guess
  const info = infos.find((i) => i.product === 'album_activation' && i.scope === 'miolove')
  if (!info) throw new UnknownPriceError(items.data[0]?.price?.id)

  const m = s.metadata ?? {}
  const uid = typeof m.firebaseUid === 'string' && m.firebaseUid ? m.firebaseUid : null
  const userOk = !!uid && (await deps.db.doc(`users/${uid}`).get()).exists
  const key = safeId(str(s.payment_intent) ?? s.id)
  const eventId = typeof m.eventId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(m.eventId) ? m.eventId : null
  const consistent = userOk && m.portal === 'miolove' && m.product === 'album_activation' && !!eventId && (m.ownerUid ?? uid) === uid

  let outcome: { v: 'activated' | 'already_activated' | 'blocked'; reason: string | null } = { v: 'blocked', reason: consistent ? null : 'metadata_mismatch' }
  if (consistent && eventId) {
    const evRef = deps.db.doc(`events/${eventId}`)
    await deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(evRef), e = snap.data()
      if (!snap.exists || e!.ownerUid !== uid || e!.deletedAt) { outcome = { v: 'blocked', reason: 'event_not_owned' }; return }
      if (e!.accessMode === 'activated') { outcome = { v: 'already_activated', reason: null }; return }
      if (e!.accessMode !== 'trial' || (await eventBrandOf(deps.db, e!)) !== 'miolove') { outcome = { v: 'blocked', reason: 'album_not_eligible' }; return }
      tx.update(evRef, {
        accessMode: 'activated', activatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        activation: { source: 'stripe', checkoutSessionId: s.id, paymentIntentId: str(s.payment_intent), stripeEventId: event.id, amountCents: s.amount_total ?? 0, currency: s.currency ?? null },
      })
      outcome = { v: 'activated', reason: null }
    })
  }
  if (outcome.v === 'blocked') logger.error('album_activation_blocked', { reason: outcome.reason, eventId, sessionId: s.id })
  if (!uid || !userOk) return                                                                                      // no known account to record the payment on: logged above, a human reconciles from Stripe
  await createOnce(deps.db.doc(`users/${uid}/payments/${key}`), {
    stripePaymentIntentId: str(s.payment_intent), stripeCheckoutSessionId: s.id, stripeInvoiceId: null, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'eur',
    status: 'succeeded', description: 'MIOLOVE Album — attivazione', kind: 'album_activation', historical: false, source: 'stripe', uid, productScope: 'miolove',
    eventId: consistent ? eventId : null, activation: outcome.v === 'blocked' ? `blocked:${outcome.reason}` : outcome.v,
    createdAt: ts(event.created), updatedAt: ts(event.created),
  })
}
