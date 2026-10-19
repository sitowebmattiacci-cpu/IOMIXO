import type { PlanTier } from '../entitlements/plans'
import type { ProductScope } from '../entitlements/scope'

/**
 * Server-side price table. The ONLY source of truth for "which Stripe price means what":
 *  - checkout accepts a price ONLY if it is in this table with `checkout: true` (the client can never pick an arbitrary price);
 *  - the webhook maps a price to a plan tier / Event Pass through the same table. An unknown price is an EXPLICIT error
 *    (UnknownPriceError → the event is recorded as failed and Stripe retries) — there is no silent fallback to `pro`.
 * Price ids are public identifiers, not secrets: they come from the non-secret deploy env (.env.<project>).
 */
export type Product = 'pro' | 'advance' | 'event_pass'
export interface PriceInfo {
  product: Product
  /** Plan tier for subscriptions ('advance' is stored as 'wedding'); null for the one-time Event Pass. */
  tier: Exclude<PlanTier, 'free'> | null
  mode: 'subscription' | 'payment'
  /** false = recognised when a webhook arrives (old subscriptions) but never offered at checkout. */
  checkout: boolean
  /** Product the purchase unlocks. Decided HERE (never by the client): every current price is IOMIXO; a future MIOLOVE price is added with scope 'miolove'. */
  scope: ProductScope
}
export class UnknownPriceError extends Error {
  constructor(public priceId: string | null | undefined) { super('unknown_price') }
}

const CURRENT: Array<[string, Omit<PriceInfo, 'checkout' | 'scope'>]> = [
  ['STRIPE_PRICE_PRO_EUR',        { product: 'pro',        tier: 'pro',     mode: 'subscription' }],
  ['STRIPE_PRICE_PRO_USD',        { product: 'pro',        tier: 'pro',     mode: 'subscription' }],
  ['STRIPE_PRICE_ADVANCE_EUR',    { product: 'advance',    tier: 'wedding', mode: 'subscription' }],
  ['STRIPE_PRICE_ADVANCE_USD',    { product: 'advance',    tier: 'wedding', mode: 'subscription' }],
  ['STRIPE_PRICE_EVENT_PASS_EUR', { product: 'event_pass', tier: null,      mode: 'payment' }],
  ['STRIPE_PRICE_EVENT_PASS_USD', { product: 'event_pass', tier: null,      mode: 'payment' }],
]
/** Older prices still attached to existing subscriptions (comma-separated lists). Recognised by the webhook only. */
const LEGACY: Array<[string, Omit<PriceInfo, 'checkout' | 'scope'>]> = [
  ['STRIPE_PRICE_LEGACY_PRO',     { product: 'pro',     tier: 'pro',     mode: 'subscription' }],
  ['STRIPE_PRICE_LEGACY_ADVANCE', { product: 'advance', tier: 'wedding', mode: 'subscription' }],
]

export type PriceTable = ReadonlyMap<string, PriceInfo>

export function buildPriceTable(env: Record<string, string | undefined> = process.env): PriceTable {
  const t = new Map<string, PriceInfo>()
  for (const [key, info] of CURRENT) { const id = env[key]?.trim(); if (id) t.set(id, { ...info, checkout: true, scope: 'iomixo' }) }
  for (const [key, info] of LEGACY) for (const id of (env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) if (!t.has(id)) t.set(id, { ...info, checkout: false, scope: 'iomixo' })
  return t
}

/** Strict lookup: throws UnknownPriceError. */
export function priceInfo(table: PriceTable, priceId: string | null | undefined): PriceInfo {
  const info = priceId ? table.get(priceId) : undefined
  if (!info) throw new UnknownPriceError(priceId)
  return info
}
export const checkoutPrice = (table: PriceTable, priceId: unknown): PriceInfo | null => {
  const info = typeof priceId === 'string' ? table.get(priceId) : undefined
  return info?.checkout ? info : null
}
