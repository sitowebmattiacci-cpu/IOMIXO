'use client'
/**
 * Logica centralizzata di "effective access" / "effective plan".
 *
 * Il piano nel DB resta 'free' | 'pro' | 'wedding' (Advance è codificato come
 * 'wedding'). L'Event Pass 24H è un accesso temporaneo separato dal piano
 * mensile: finché esiste un pass attivo e non scaduto l'utente ottiene accesso
 * premium equivalente ad Advance, senza che il suo piano DB cambi.
 *
 * Alla scadenza del pass l'utente torna automaticamente al piano reale.
 */
import useSWR from 'swr'
import { auth, billing } from '@/lib/api'
import { isAdvancePlan, isProPlan } from '@/lib/plan'
import type { User, EventPass } from '@/types'

export type EffectivePlan = 'free' | 'pro' | 'wedding' | 'event_pass'
export type EffectivePlanLabel = 'Free' | 'Pro' | 'Advance' | 'Event Pass'

/** True se il pass è attivo e non scaduto. */
export function isEventPassActive(
  pass: { status?: string; valid_until?: string } | null | undefined,
): boolean {
  if (!pass) return false
  return pass.status === 'active' && new Date(pass.valid_until ?? 0).getTime() > Date.now()
}

/** Ritorna il primo Event Pass attivo e non scaduto (se presente). */
export function findActiveEventPass<T extends { status?: string; valid_until?: string }>(
  passes: T[] | null | undefined,
): T | undefined {
  if (!passes) return undefined
  return passes.find(isEventPassActive)
}

/**
 * Calcola il piano effettivo.
 * Priorità: piano Advance reale > Event Pass attivo > Pro reale > Free.
 */
export function computeEffectivePlan(
  plan: string | null | undefined,
  hasActiveEventPass: boolean,
): EffectivePlan {
  if (isAdvancePlan(plan)) return 'wedding'
  if (hasActiveEventPass) return 'event_pass'
  if (isProPlan(plan)) return 'pro'
  return 'free'
}

/** Label user-facing del piano effettivo. */
export function effectivePlanLabel(effective: EffectivePlan): EffectivePlanLabel {
  switch (effective) {
    case 'wedding':    return 'Advance'
    case 'event_pass': return 'Event Pass'
    case 'pro':        return 'Pro'
    default:           return 'Free'
  }
}

export interface EffectiveAccess {
  user: User | undefined
  isLoading: boolean
  /** Event Pass attivo e non scaduto (se presente). */
  activePass: EventPass | undefined
  hasActiveEventPass: boolean
  /** Piano effettivo, considerando il pass temporaneo. */
  effectivePlan: EffectivePlan
  /** Label user-facing del piano effettivo. */
  effectiveLabel: EffectivePlanLabel
  /** Accesso alle funzioni Advance (Party Mode + Wedding Edition). */
  hasAdvanceAccess: boolean
  /**
   * Accesso alle funzioni Pro (link social, prossime date / calendario eventi).
   * Vero per piano Pro, piano Advance ('wedding') o Event Pass 24H attivo.
   */
  hasProAccess: boolean
  /** Piano effettivo === 'pro'. */
  isPro: boolean
  /** Nessun accesso premium (effettivo === 'free'). */
  isFree: boolean
  /** Scadenza dell'Event Pass attivo (ISO) o null. */
  passValidUntil: string | null
}

/**
 * Hook centralizzato: combina il profilo utente con gli Event Pass per esporre
 * il piano effettivo a tutta la UI. Usa le stesse chiavi SWR ('me',
 * 'event-passes') delle altre pagine così la cache è condivisa.
 */
export function useEffectiveAccess(): EffectiveAccess {
  const { data: user, isLoading: loadingUser } = useSWR<User>('me', () => auth.me(), {
    dedupingInterval: 30_000,
  })
  const { data: passes, isLoading: loadingPasses } = useSWR(
    'event-passes',
    () => billing.getEventPasses(),
    { onError: () => {} },
  )

  const activePass = findActiveEventPass(passes as EventPass[] | undefined)
  const hasActiveEventPass = !!activePass
  const effectivePlan = computeEffectivePlan(user?.plan, hasActiveEventPass)
  const hasAdvanceAccess = isAdvancePlan(user?.plan) || hasActiveEventPass
  const hasProAccess = isProPlan(user?.plan) || isAdvancePlan(user?.plan) || hasActiveEventPass

  return {
    user,
    isLoading: loadingUser || loadingPasses,
    activePass,
    hasActiveEventPass,
    effectivePlan,
    effectiveLabel: effectivePlanLabel(effectivePlan),
    hasAdvanceAccess,
    hasProAccess,
    isPro: effectivePlan === 'pro',
    isFree: effectivePlan === 'free',
    passValidUntil: activePass?.valid_until ?? null,
  }
}
