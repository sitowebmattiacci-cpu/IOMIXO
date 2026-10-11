import { PLAN_LIMITS, normalizePlan, type PlanLimits, type PlanTier } from './plans'

/**
 * Single place that decides what an account may do. Pure (no I/O, no clock): callers pass `now`.
 * Semantics are those of the legacy backend (services/plan.ts), kept on purpose:
 *   accountTier   = users.plan (normalized), here also `free` once `plan.validUntil` has passed
 *   eventAccess   = hasEventAccess: accountTier is 'wedding' (Advance) OR a valid Event Pass applies
 *   effectiveTier = getEffectivePlan: accountTier unless it is 'free', then 'wedding' while a pass applies
 *   (so a PRO account with a pass has eventAccess=true but effectiveTier='pro': remote games stay locked — as in legacy)
 * A pass applies when status=='active' && validUntil > now and it is unscoped (any event) or scoped to THIS event.
 * Without an `event` only unscoped passes apply (legacy hasEventAccess(userId) without sessionId).
 * The client never takes part in this decision.
 */
export type PassStatus = 'active' | 'expired' | 'refunded'

export interface PlanDoc { tier: string; source?: string; validUntil?: Date | null }
export interface EventPassDoc {
  id: string
  status: PassStatus
  validUntil: Date
  /** Firestore event id and/or legacy Supabase session id this pass is scoped to; both null/absent = valid for any event. */
  eventId?: string | null
  legacySessionId?: string | null
}
export interface EventRef { id: string; legacySessionId?: string | null }

export interface Entitlements {
  accountTier: PlanTier
  planExpired: boolean
  effectiveTier: PlanTier
  eventAccess: boolean
  /** Pass that grants (or would grant) the access, if any. */
  passId: string | null
  limits: PlanLimits
  /** One boolean per product gate, named after the legacy routes that use it. */
  gates: {
    djGames: boolean          // /sessions/:id/games/* (hasEventAccess)
    remoteGames: boolean      // /public/:slug/games/* (limits.weddingGames of the effective tier)
    dedications: boolean
    polls: boolean
    photos: boolean
    screen: boolean
  }
}

export function passApplies(pass: EventPassDoc, event: EventRef | null | undefined, now: Date): boolean {
  if (pass.status !== 'active' || !(pass.validUntil.getTime() > now.getTime())) return false
  const scoped = Boolean(pass.eventId || pass.legacySessionId)
  if (!scoped) return true
  if (!event) return false
  return (Boolean(pass.eventId) && pass.eventId === event.id)
      || (Boolean(pass.legacySessionId) && pass.legacySessionId === event.legacySessionId)
}

export function resolveEntitlements(input: {
  plan?: PlanDoc | null
  passes?: EventPassDoc[]
  event?: EventRef | null
  now: Date
}): Entitlements {
  const { plan, event, now } = input
  const planExpired = Boolean(plan?.validUntil && plan.validUntil.getTime() <= now.getTime())
  const accountTier: PlanTier = planExpired ? 'free' : normalizePlan(plan?.tier)
  const pass = (input.passes ?? [])
    .filter((p) => passApplies(p, event, now))
    .sort((a, b) => b.validUntil.getTime() - a.validUntil.getTime())[0] ?? null
  const eventAccess = accountTier === 'wedding' || pass !== null
  const effectiveTier: PlanTier = accountTier !== 'free' ? accountTier : (eventAccess ? 'wedding' : 'free')
  const limits = PLAN_LIMITS[effectiveTier]
  return {
    accountTier, planExpired, effectiveTier, eventAccess, passId: pass?.id ?? null, limits,
    gates: {
      djGames: eventAccess, remoteGames: limits.weddingGames, dedications: eventAccess,
      polls: eventAccess, photos: eventAccess, screen: eventAccess,
    },
  }
}
