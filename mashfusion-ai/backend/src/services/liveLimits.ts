import { supabaseAdmin } from '../config/supabase'
import { PLAN_LIMITS, type PlanTier } from '../config/plans'
import { getUserPlan } from './plan'

export interface LimitCheckResult {
  ok: boolean
  reason?: string
  plan: PlanTier
}

/** Can the user open a new active session? */
export async function canCreateSession(userId: string): Promise<LimitCheckResult> {
  const plan = await getUserPlan(userId)
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
  const plan = await getUserPlan(djId)
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
