import { supabaseAdmin } from '../config/supabase'
import { AppError } from '../middleware/errorHandler'
import { normalizePlan, PLAN_LIMITS, type PlanTier, type PlanLimits } from '../config/plans'

/** Returns the user's normalised plan tier. Defaults to 'free' on any error. */
export async function getUserPlan(userId: string): Promise<PlanTier> {
  const { data } = await supabaseAdmin
    .from('users').select('plan').eq('id', userId).maybeSingle()
  return normalizePlan(data?.plan)
}

/**
 * Piano effettivo: il piano DB, ma promosso ad Advance ('wedding') quando
 * l'utente ha un Event Pass 24H attivo. Così tutti i limiti/feature premium
 * (sessioni illimitate, Party/Wedding, ecc.) valgono per la durata del pass.
 * Alla scadenza del pass si torna automaticamente al piano reale.
 */
export async function getEffectivePlan(userId: string, sessionId?: string): Promise<PlanTier> {
  const plan = await getUserPlan(userId)
  if (plan !== 'free') return plan
  return (await hasEventAccess(userId, sessionId)) ? 'wedding' : 'free'
}

export async function getUserPlanLimits(userId: string): Promise<{ plan: PlanTier; limits: PlanLimits }> {
  const plan = await getUserPlan(userId)
  return { plan, limits: PLAN_LIMITS[plan] }
}

/** Throws AppError(402) if the user is not on the Advance plan. */
export async function requireWeddingPlan(userId: string): Promise<PlanTier> {
  const plan = await getUserPlan(userId)
  if (plan !== 'wedding') {
    throw new AppError(
      'Funzione disponibile con il piano Advance. Aggiorna il piano per continuare.',
      402,
    )
  }
  return plan
}

/** Lightweight feature gate: returns true/false instead of throwing. */
export async function hasFeature(userId: string, feature: keyof PlanLimits): Promise<boolean> {
  const plan = await getUserPlan(userId)
  const value = PLAN_LIMITS[plan][feature]
  return value === true || (typeof value === 'number' && value > 0)
}

/**
 * Check se l'utente ha accesso alle feature evento (Party Mode + Wedding Edition):
 * - piano wedding/advance attivo, OPPURE
 * - event pass 24h valido (valid_until > now())
 *
 * @param userId - ID utente
 * @param sessionId - (opzionale) ID sessione specifica
 * @returns true se ha accesso, false altrimenti
 */
export async function hasEventAccess(userId: string, sessionId?: string): Promise<boolean> {
  // Check piano utente
  const plan = await getUserPlan(userId)
  if (plan === 'wedding') return true

  // Check event pass valido
  const { data } = await supabaseAdmin
    .from('event_passes')
    .select('valid_until')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('valid_until', new Date().toISOString())
    .or(sessionId ? `session_id.is.null,session_id.eq.${sessionId}` : 'session_id.is.null')
    .maybeSingle()

  return !!data
}

/**
 * Ritorna l'event pass attivo per l'utente (se presente)
 */
export async function getActiveEventPass(userId: string, sessionId?: string) {
  const { data } = await supabaseAdmin
    .from('event_passes')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('valid_until', new Date().toISOString())
    .or(sessionId ? `session_id.is.null,session_id.eq.${sessionId}` : 'session_id.is.null')
    .order('valid_until', { ascending: false })
    .maybeSingle()

  return data
}

/** Throws AppError(402) se l'utente non ha accesso Evento (Party Mode + Wedding Edition) */
export async function requireEventAccess(userId: string, sessionId?: string): Promise<void> {
  const hasAccess = await hasEventAccess(userId, sessionId)
  if (!hasAccess) {
    throw new AppError(
      'Funzione disponibile con il piano Advance o un Event Pass 24H. Acquista il pass o aggiorna il piano.',
      402,
    )
  }
}

// ─── Back-compat aliases (deprecated) ─────────────────────────
// Mantenuti per non rompere eventuali import esterni; preferire
// le nuove API hasEventAccess / getActiveEventPass / requireEventAccess.
/** @deprecated use hasEventAccess */
export const hasWeddingAccess = hasEventAccess
/** @deprecated use getActiveEventPass */
export const getActiveWeddingPass = getActiveEventPass
/** @deprecated use requireEventAccess */
export const requireWeddingAccess = requireEventAccess
