// ── Multi-currency pricing helper ─────────────────────────────
// EUR for Italian / French / Spanish · USD for English.
// Display amounts and Stripe Price IDs are selected from the active locale.
import type { Locale } from '@/lib/i18n'

export type Currency = 'eur' | 'usd'
export type PaidPlan = 'pro' | 'wedding'

/**
 * English audience pays in USD, everyone else (it/fr/es) in EUR.
 * Defensive: accepts any locale string (e.g. 'en', 'EN', 'en-US', 'en_US',
 * undefined) and routes anything starting with "en" to USD, the rest to EUR.
 */
export function currencyForLocale(locale: Locale | string | null | undefined): Currency {
  return String(locale ?? '').toLowerCase().startsWith('en') ? 'usd' : 'eur'
}

export function currencySymbol(currency: Currency): string {
  return currency === 'usd' ? '$' : '€'
}

/** Monthly subscription display amounts per plan and currency. */
export const PLAN_PRICING: Record<PaidPlan, Record<Currency, number>> = {
  pro:     { eur: 9.99,  usd: 9.99 },
  wedding: { eur: 19.99, usd: 19.99 },
}

/** Event Pass 24H one-time display amount per currency. */
export const EVENT_PASS_PRICING: Record<Currency, number> = { eur: 7.99, usd: 7.99 }

/**
 * Format an amount with the right symbol and decimal separator.
 * EUR uses a comma (€9,99), USD uses a dot ($9.99).
 */
export function formatPrice(amount: number, currency: Currency): string {
  const symbol = currencySymbol(currency)
  const value = amount.toFixed(2)
  return currency === 'usd' ? `${symbol}${value}` : `${symbol}${value.replace('.', ',')}`
}

// ── Stripe Price ID selection ─────────────────────────────────
// Active Stripe TEST price IDs (public identifiers, not secrets) used as the
// guaranteed default so checkout always targets a purchasable, active price
// even if a deployment's env vars are stale or missing. NEXT_PUBLIC_* env vars
// (inlined by Next.js at build time) still take priority when present.
const DEFAULT_PRICE_IDS = {
  pro:     { eur: 'price_1TghhxK5K6YO4jBDSLcSF6Az', usd: 'price_1TghhxK5K6YO4jBD3e2E0q0D' },
  wedding: { eur: 'price_1TghhyK5K6YO4jBDJfrAoceZ', usd: 'price_1TghhzK5K6YO4jBDnKol76T2' },
  event:   { eur: 'price_1TghhzK5K6YO4jBDZT9Ob31A', usd: 'price_1Tghi0K5K6YO4jBDGWTdYmGS' },
} as const

export function planPriceId(plan: PaidPlan, currency: Currency): string {
  if (plan === 'pro') {
    return (
      (currency === 'usd'
        ? process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_USD
        : process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_EUR) ||
      DEFAULT_PRICE_IDS.pro[currency]
    )
  }
  return (
    (currency === 'usd'
      ? process.env.NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_USD
      : process.env.NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_EUR) ||
    DEFAULT_PRICE_IDS.wedding[currency]
  )
}

export function eventPassPriceId(currency: Currency): string {
  return (
    (currency === 'usd'
      ? process.env.NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_USD
      : process.env.NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_EUR) ||
    DEFAULT_PRICE_IDS.event[currency]
  )
}
