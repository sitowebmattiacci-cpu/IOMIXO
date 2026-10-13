import { httpsCallable } from 'firebase/functions'
import { getFirebaseDb, getFirebaseFunctions } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { authProvider } from '../auth'
import { billingFlag } from './flags'
import { listSubscriptions, listPayments } from '../firebase/repositories/userRepository'
import { eventPassesFor } from './dashboardService'
import type { Payment, Subscription, EventPass } from '@/types'

/**
 * Billing on Firebase (checkout, portal, subscription, payments, Event Passes), behind NEXT_PUBLIC_FIREBASE_BILLING=on|true and a Firebase account.
 * Checkout / portal are callables (Stripe stays the provider; prices, customer, URLs and metadata are decided server-side). Everything else is a direct
 * Firestore read allowed by the rules to the owner. Every method resolves to `null` when it does not apply (flag off / not a Firebase account) so
 * lib/api.ts keeps the legacy Express /stripe routes; results are wrapped as `{ data }` because "no subscription" is a legitimate answer.
 */
export const billingEnabled = () => billingFlag() && authProvider() === 'firebase'

const MESSAGES: Record<string, string> = {
  invalid_price: 'Piano non disponibile',
  invalid_payload: 'Dati non validi',
  account_required: 'Accedi con il tuo account',
  account_not_ready: 'Account non ancora pronto, riprova tra poco',
  trial_not_available: 'La prova gratuita non è disponibile per questo account',
  event_not_found: 'Sessione non trovata',
  checkout_failed: 'Impossibile avviare il pagamento, riprova',
  no_billing_account: 'Nessun account di fatturazione trovato',
  portal_failed: 'Impossibile aprire il portale di fatturazione, riprova',
}
async function call<Out>(name: string, payload: object): Promise<Out> {
  try { return (await httpsCallable<object, Out>(getFirebaseFunctions(), name)(payload)).data }
  catch (e) {
    const err = e as { message?: string; details?: { reason?: string } }
    throw new Error((err.details?.reason && MESSAGES[err.details.reason]) || err.message || 'Operazione non riuscita')
  }
}
async function account() {
  if (!billingEnabled()) return null
  const user = await waitForAuthReady()
  return user && !user.isAnonymous ? user : null
}
const iso = (d: Date | null) => (d ?? new Date(0)).toISOString()
const LIVE = ['active', 'trialing']

export const billingOps = {
  async checkout(priceId: string, opts: { trial?: boolean; eventId?: string } = {}): Promise<{ url: string } | null> {
    if (!(await account())) return null
    return call<{ url: string }>('createCheckoutSession', { priceId, ...(opts.trial ? { trial: true } : {}), ...(opts.eventId ? { eventId: opts.eventId } : {}) })
  },
  async portal(): Promise<{ url: string } | null> {
    if (!(await account())) return null
    return call<{ url: string }>('createPortalSession', {})
  },

  /** The CURRENT subscription as maintained by Stripe's webhook. Historical (legacy backfill) documents are never shown as current: their status is stale. */
  async subscription(): Promise<{ data: Subscription | null } | null> {
    const user = await account(); if (!user) return null
    const docs = (await listSubscriptions(getFirebaseDb(), user.uid)).filter((s) => !s.historical)
    const pick = docs.sort((a, b) => Number(LIVE.includes(b.status)) - Number(LIVE.includes(a.status)) || (b.currentPeriodEnd?.getTime() ?? 0) - (a.currentPeriodEnd?.getTime() ?? 0))[0]
    if (!pick) return { data: null }
    return { data: {
      id: pick.id, user_id: user.uid, stripe_subscription_id: pick.stripeSubscriptionId, stripe_customer_id: pick.stripeCustomerId ?? '',
      plan: pick.tier ?? 'free', status: pick.status as Subscription['status'],
      current_period_start: iso(pick.currentPeriodStart), current_period_end: iso(pick.currentPeriodEnd), cancel_at_period_end: pick.cancelAtPeriodEnd,
    } }
  },

  async payments(limit = 10): Promise<{ data: Payment[] } | null> {
    const user = await account(); if (!user) return null
    return { data: (await listPayments(getFirebaseDb(), user.uid, 50)).slice(0, limit).map((p): Payment => ({
      id: p.id, user_id: user.uid, stripe_payment_intent_id: p.stripePaymentIntentId, amount_cents: p.amountCents, currency: p.currency,
      status: (['succeeded', 'pending', 'failed', 'refunded'].includes(p.status) ? p.status : 'failed') as Payment['status'], description: p.description, created_at: iso(p.createdAt),
    })) }
  },

  async eventPasses(): Promise<{ data: EventPass[] } | null> {
    const user = await account(); if (!user) return null
    return { data: await eventPassesFor(user.uid) }
  },
}
