import { supabaseAdmin } from '../config/supabase'
import { PLAN_LIMITS, type PlanTier } from '../config/plans'
import { getEffectivePlan } from './plan'

export interface LimitCheckResult {
  ok: boolean
  reason?: string
  plan: PlanTier
}

/** Can the user open a new active session? */
export async function canCreateSession(userId: string): Promise<LimitCheckResult> {
  // Considera il piano effettivo: un Event Pass 24H attivo sblocca i limiti
  // premium (sessioni illimitate) anche se il piano DB resta 'free'.
  const plan = await getEffectivePlan(userId)
  const limits = PLAN_LIMITS[plan]
  if (!isFinite(limits.maxActiveSessions)) return { ok: true, plan }

  const { count } = await supabaseAdmin
    .from('live_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('dj_id', userId)
    .eq('is_active', true)

  if ((count ?? 0) >= limits.maxActiveSessions) {
    return {
      ok: false,
      plan,
      reason: `Il piano ${plan.toUpperCase()} permette al massimo ${limits.maxActiveSessions} sessione attiva. Passa a Pro per sessioni illimitate.`,
    }
  }
  return { ok: true, plan }
}

/** Can the given session accept one more request right now? */
export async function canAcceptRequest(sessionId: string, djId: string): Promise<LimitCheckResult> {
  // Piano effettivo: un Event Pass 24H attivo sblocca i limiti premium
  // (richieste illimitate) per la durata del pass.
  const plan = await getEffectivePlan(djId, sessionId)
  const limits = PLAN_LIMITS[plan]
  if (!isFinite(limits.maxRequestsPerSession)) return { ok: true, plan }

  const { count } = await supabaseAdmin
    .from('live_requests')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)

  if ((count ?? 0) >= limits.maxRequestsPerSession) {
    return {
      ok: false,
      plan,
      reason: 'Il DJ ha raggiunto il limite massimo di richieste per questa sessione.',
    }
  }
  return { ok: true, plan }
}
