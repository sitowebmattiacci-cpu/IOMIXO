// ── Multi-currency pricing helper ─────────────────────────────
// EUR for Italian / French / Spanish · USD for English.
// Display amounts and Stripe Price IDs are selected from the active locale.
import type { Locale } from '@/lib/i18n'

export type Currency = 'eur' | 'usd'
export type PaidPlan = 'pro' | 'wedding'

/** English audience pays in USD, everyone else (it/fr/es) in EUR. */
export function currencyForLocale(locale: Locale): Currency {
  return locale === 'en' ? 'usd' : 'eur'
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
// NEXT_PUBLIC_* vars must be referenced literally so Next.js inlines them
// at build time. Per-currency vars take priority; the legacy single-currency
// vars remain as a fallback so existing deployments keep working.

export function planPriceId(plan: PaidPlan, currency: Currency): string {
  if (plan === 'pro') {
    return (
      (currency === 'usd'
        ? process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_USD
        : process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID_EUR) ||
      process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID ||
      ''
    )
  }
  return (
    (currency === 'usd'
      ? process.env.NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_USD
      : process.env.NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID_EUR) ||
    process.env.NEXT_PUBLIC_STRIPE_WEDDING_PRICE_ID ||
    process.env.NEXT_PUBLIC_STRIPE_CLUB_PRICE_ID ||
    process.env.NEXT_PUBLIC_STRIPE_STUDIO_PRICE_ID ||
    ''
  )
}

export function eventPassPriceId(currency: Currency): string {
  return (
    (currency === 'usd'
      ? process.env.NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_USD
      : process.env.NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS_EUR) ||
    process.env.NEXT_PUBLIC_STRIPE_PRICE_EVENT_PASS ||
    process.env.NEXT_PUBLIC_STRIPE_PRICE_WEDDING_PASS ||
    ''
  )
}
