import Stripe from 'stripe'
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions/logger'
import type { StripeApi } from './stripeApi'
import { priceInfo, UnknownPriceError, type PriceInfo, type PriceTable } from './prices'
import { eventBrandOf } from '../owner/brand'
import { enqueueMioloveMailSafe } from '../mail/miolove/outbox'
import { activationBlockReason, activationDates } from '../photos/albumLifecycle'

/**
 * MIOLOVE Stripe webhook → Firestore. A SEPARATE endpoint, secret and Stripe account from IOMIXO's `stripeWebhook` (billing/webhook.ts, untouched):
 *
 *  - It is signed with the MIOLOVE webhook secret only. An IOMIXO-signed event fails verification here, and a MIOLOVE-signed one fails on the IOMIXO endpoint.
 *  - It handles ONE thing: a paid Checkout Session of the MIOLOVE album price activates ONE album (events/{eventId}.accessMode → 'activated', activatedAt = now, expiresAt =
 *    activatedAt + 365 days, both from the SERVER clock). Albums are independent: no other album and no account-level state is touched. Every other event type is
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

/** What was REALLY paid, from the signature-verified Checkout Session (never from the language or a price table). Anything not a positive amount in a 3-letter currency is left out: the e-mail then shows no figure. */
export function paidAmountOf(s: Stripe.Checkout.Session): { amountCents?: number; currency?: string } {
  const cents = s.amount_total, cur = s.currency
  return typeof cents === 'number' && Number.isInteger(cents) && cents > 0 && typeof cur === 'string' && /^[a-z]{3}$/i.test(cur) ? { amountCents: cents, currency: cur.toLowerCase() } : {}
}

async function onCheckout(deps: MioloveWebhookDeps, event: Stripe.Event, s: Stripe.Checkout.Session) {
  const now = (deps.now ?? (() => new Date()))()
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

  let outcome: { v: 'activated' | 'already_activated' | 'blocked'; reason: string | null; samePayment?: boolean } = { v: 'blocked', reason: consistent ? null : 'metadata_mismatch' }
  if (consistent && eventId) {
    const evRef = deps.db.doc(`events/${eventId}`)
    await deps.db.runTransaction(async (tx) => {
      const snap = await tx.get(evRef), e = snap.data()
      if (!snap.exists || e!.ownerUid !== uid || e!.deletedAt) { outcome = { v: 'blocked', reason: 'event_not_owned' }; return }
      const why = activationBlockReason(e!, now)
      if (why === 'already_activated') { outcome = { v: 'already_activated', reason: null, samePayment: e!.activation?.checkoutSessionId === s.id || (!!str(s.payment_intent) && e!.activation?.paymentIntentId === str(s.payment_intent)) }; return }
      if (why || (await eventBrandOf(deps.db, e!)) !== 'miolove') { outcome = { v: 'blocked', reason: 'album_not_eligible' }; return }   // lapsed / being purged: an old Checkout Session cannot revive it
      tx.update(evRef, {
        accessMode: 'activated', ...activationDates(now), updatedAt: FieldValue.serverTimestamp(),
        // Data model for the reminder e-mails (30 / 7 / 1 days before expiresAt): the sender stamps each one here, once.
        retention: { days: 365, reminders: {} },
        activation: { source: 'stripe', checkoutSessionId: s.id, paymentIntentId: str(s.payment_intent), stripeEventId: event.id, amountCents: s.amount_total ?? 0, currency: s.currency ?? null },
      })
      outcome = { v: 'activated', reason: null }
    })
  }
  if (outcome.v === 'activated' && eventId) await enqueueMioloveMailSafe(deps.db, 'album_activated', eventId, { now, extraVars: paidAmountOf(s) })     // queued once per album (same payment replayed = same document); never fails the webhook
  if (outcome.v === 'blocked') logger.error('album_activation_blocked', { reason: outcome.reason, eventId, sessionId: s.id })
  if (!uid || !userOk) return                                                                                      // no known account to record the payment on: logged above, a human reconciles from Stripe
  await createOnce(deps.db.doc(`users/${uid}/payments/${key}`), {
    stripePaymentIntentId: str(s.payment_intent), stripeCheckoutSessionId: s.id, stripeInvoiceId: null, amountCents: s.amount_total ?? 0, currency: s.currency ?? 'eur',
    status: 'succeeded', description: 'MIOLOVE Album — attivazione', kind: 'album_activation', historical: false, source: 'stripe', uid, productScope: 'miolove',
    eventId: consistent ? eventId : null, activation: outcome.v === 'blocked' ? `blocked:${outcome.reason}` : outcome.v,
    createdAt: ts(event.created), updatedAt: ts(event.created),
  })
  // A payment that can activate NOTHING (the album is past its recovery window / purged / not the buyer's, or it is a second payment for an album already paid) is refunded in full,
  // once: the Stripe idempotency key is derived from the payment intent, so a retried webhook or a replay can never refund twice. A refund failure answers 500 (Stripe retries; the key keeps it safe).
  // Never refunded automatically: unknown buyer / metadata that disagrees (a human reconciles) and the payment that DID activate an album.
  const intent = str(s.payment_intent)
  const refundable = outcome.v === 'blocked' ? outcome.reason === 'album_not_eligible' || outcome.reason === 'event_not_owned' : outcome.v === 'already_activated' && !outcome.samePayment
  if (!refundable || !intent || !(s.amount_total && s.amount_total > 0)) return
  const ledger = deps.db.doc(`users/${uid}/payments/${key}`)
  try {
    const r = await deps.stripe.refunds.create({ payment_intent: intent, reason: outcome.v === 'already_activated' ? 'duplicate' : 'requested_by_customer', metadata: { portal: 'miolove', eventId: eventId ?? '', cause: outcome.v === 'blocked' ? String(outcome.reason) : 'duplicate_payment' } }, { idempotencyKey: `miolove-refund-${intent}` })
    await ledger.update({ status: 'refunded', refund: { id: r.id, status: r.status, at: Timestamp.fromDate(now) }, updatedAt: Timestamp.fromDate(now) })
  } catch (e) {
    await ledger.update({ refund: { status: 'failed', error: String((e as { code?: unknown }).code ?? 'refund_error').slice(0, 80), at: Timestamp.fromDate(now) } }).catch(() => {})
    throw e
  }
}
