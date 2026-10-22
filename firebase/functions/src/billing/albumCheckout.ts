import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'
import type { Firestore } from 'firebase-admin/firestore'
import { isStripeError, type StripeApi } from './stripeApi'
import { albumActivationPrice, type PriceTable } from './prices'
import { ensureCustomer, type AuthLike, type BillingConfig } from './checkout'
import { eventBrandOf } from '../owner/brand'

/**
 * createAlbumCheckoutSession (owner callable): the ONE commercial purchase of MIOLOVE — a one-time payment that activates ONE album (events/{eventId}.accessMode → 'activated',
 * written only by the verified webhook, never by this call nor by the return URL).
 *
 * The client sends an event id and its language (a fixed enum) and nothing else: price, currency, mode, customer, URLs and metadata are decided here.
 * Currency follows the language exactly like the prices the page shows (English → USD, Italian / French / Spanish → EUR).
 * It refuses: an anonymous caller, an event that is not the caller's own, an IOMIXO event, an album that is not a free trial (already activated or not eligible).
 */
const fail = (code: FunctionsErrorCode, reason: string): never => { throw new HttpsError(code, reason, { reason }) }

export type AlbumLocale = 'it' | 'en' | 'fr' | 'es'
export interface AlbumCheckoutInput { eventId: string; locale: AlbumLocale }
const LOCALES: readonly AlbumLocale[] = ['it', 'en', 'fr', 'es']
export const albumCurrencyFor = (locale: AlbumLocale): 'eur' | 'usd' => (locale === 'en' ? 'usd' : 'eur')

export function parseAlbumCheckoutInput(d: unknown): AlbumCheckoutInput {
  const o = (d ?? {}) as Record<string, unknown>                       // any other field (priceId, amount, currency…) is not even read
  if (typeof o.eventId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(o.eventId)) return fail('invalid-argument', 'invalid_payload')
  const locale = (LOCALES as readonly unknown[]).includes(o.locale) ? (o.locale as AlbumLocale) : 'it'
  return { eventId: o.eventId, locale }
}

export async function createAlbumCheckoutSession(
  db: Firestore, stripe: StripeApi, prices: PriceTable, cfg: BillingConfig, authIn: AuthLike | undefined, input: AlbumCheckoutInput,
): Promise<{ url: string }> {
  if (!authIn?.uid || authIn.token.firebase?.sign_in_provider === 'anonymous') return fail('unauthenticated', 'account_required')
  const auth = authIn
  const ref = db.doc(`events/${input.eventId}`), snap = await ref.get()
  // Same answer for "missing", "deleted" and "not yours": no event id is confirmed to a stranger.
  if (!snap.exists || snap.data()!.ownerUid !== auth.uid || snap.data()!.deletedAt) return fail('not-found', 'event_not_found')
  const ev = snap.data()!
  if ((await eventBrandOf(db, ev)) !== 'miolove') return fail('permission-denied', 'not_miolove_album')
  if (ev.accessMode === 'activated') return fail('failed-precondition', 'already_activated')
  if (ev.accessMode !== 'trial') return fail('failed-precondition', 'album_not_eligible')

  // Never fall back to the IOMIXO origin: without a MIOLOVE origin or a configured price there is simply no checkout yet.
  if (!cfg.coupleBaseUrl) return fail('failed-precondition', 'checkout_unavailable')
  const price = albumActivationPrice(prices, albumCurrencyFor(input.locale))
  if (!price) return fail('failed-precondition', 'checkout_unavailable')

  const customer = await ensureCustomer(db, stripe, auth.uid, auth.token.email ?? '')
  const metadata: Record<string, string> = {
    firebaseUid: auth.uid, ownerUid: auth.uid, portal: 'miolove', product: 'album_activation', productScope: 'miolove', checkoutType: 'album_activation', eventId: input.eventId,
  }
  const base = cfg.coupleBaseUrl.replace(/\/+$/, '')
  try {
    const session = await stripe.checkout.sessions.create({
      customer, mode: 'payment', line_items: [{ price: price.id, quantity: 1 }], payment_method_types: ['card', 'paypal'], allow_promotion_codes: true,
      client_reference_id: input.eventId, locale: input.locale, metadata, payment_intent_data: { metadata },
      success_url: `${base}/sessions/${input.eventId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?payment=cancelled&album=${input.eventId}`,
    })
    if (!session.url) return fail('internal', 'checkout_failed')
    return { url: session.url }
  } catch (e) {
    if (e instanceof HttpsError) throw e
    if (isStripeError(e)) return fail('failed-precondition', 'checkout_failed')                // Stripe's message is not forwarded
    throw e
  }
}
