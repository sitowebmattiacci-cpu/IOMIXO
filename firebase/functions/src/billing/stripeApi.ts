import Stripe from 'stripe'

/** The few Stripe calls the billing code makes. The real client satisfies it; tests inject a fake (no network). */
export interface StripeApi {
  customers: {
    retrieve(id: string): Promise<{ id: string; deleted?: boolean }>
    create(params: Stripe.CustomerCreateParams): Promise<{ id: string }>
  }
  checkout: { sessions: {
    create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>
    listLineItems(id: string, params?: Stripe.Checkout.SessionListLineItemsParams): Promise<{ data: Array<{ price?: { id: string } | null }> }>
  } }
  billingPortal: { sessions: { create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }> } }
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>
    list(params: Stripe.SubscriptionListParams): Promise<{ data: Stripe.Subscription[] }>
    cancel(id: string): Promise<unknown>
  }
}

/** API version pinned like the legacy backend (webhook payload shape depends on it). */
export const STRIPE_API_VERSION = '2024-04-10'
export const makeStripe = (secretKey: string): StripeApi => new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION }) as unknown as StripeApi
export const isStripeError = (e: unknown): e is { type: string; code?: string; message: string } =>
  typeof e === 'object' && e !== null && typeof (e as { type?: unknown }).type === 'string' && String((e as { type: string }).type).startsWith('Stripe')
