/**
 * Helper centralizzato per la lettura del piano utente.
 *
 * Il piano è memorizzato in DB come 'free' | 'pro' | 'wedding'. Lo storico
 * accetta anche alias legacy (club, studio, pro_plus, premium_wedding,
 * wedding_edition_plan, advance) che vengono normalizzati al tier Advance.
 *
 * Internamente il tier Advance è codificato come 'wedding' per non rompere
 * le strutture esistenti (PLAN_LIMITS, PLAN_CREDITS, webhook Stripe).
 * Lato UI deve essere mostrato come "Advance".
 */

export const ADVANCE_PLAN_ALIASES = [
  'wedding',
  'advance',
  'club',
  'studio',
  'pro_plus',
  'premium_wedding',
  'wedding_edition_plan',
] as const

export type DisplayPlan = 'free' | 'pro' | 'wedding'

export function isAdvancePlan(plan: string | null | undefined): boolean {
  if (!plan) return false
  return (ADVANCE_PLAN_ALIASES as readonly string[]).includes(plan)
}

export function isProPlan(plan: string | null | undefined): boolean {
  return plan === 'pro'
}

export function isFreePlan(plan: string | null | undefined): boolean {
  return !plan || plan === 'free'
}

/** Normalizza il piano grezzo nei tre tier canonici. */
export function normalisePlan(plan: string | null | undefined): DisplayPlan {
  if (isAdvancePlan(plan)) return 'wedding'
  if (plan === 'pro') return 'pro'
  return 'free'
}

/** Label user-facing del piano. */
export function planLabel(plan: string | null | undefined): 'Free' | 'Pro' | 'Advance' {
  if (isAdvancePlan(plan)) return 'Advance'
  if (plan === 'pro') return 'Pro'
  return 'Free'
}
