import { supabaseAdmin } from '../config/supabase'
import { logger } from '../config/logger'
import { PLAN_CREDITS } from '../config/plans'

/**
 * Resets credits_remaining for users whose credits_reset_at has passed.
 * Sets next reset date 30 days from now.
 */
export async function resetMonthlyCredits(): Promise<void> {
  try {
    // Fetch users whose reset date has passed
    const { data: due, error: fetchErr } = await supabaseAdmin
      .from('users')
      .select('id, plan')
      .lte('credits_reset_at', new Date().toISOString())
      .not('credits_reset_at', 'is', null)

    if (fetchErr) throw fetchErr
    if (!due || due.length === 0) return

    const nextReset = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    for (const u of due) {
      const credits = PLAN_CREDITS[u.plan as keyof typeof PLAN_CREDITS] ?? 1
      await supabaseAdmin
        .from('users')
        .update({ credits_remaining: credits, credits_reset_at: nextReset })
        .eq('id', u.id)
    }

    logger.info(`Monthly credit reset: ${due.length} users updated`)
  } catch (err) {
    logger.error('Monthly credit reset failed', { err })
  }
}

/**
 * Schedules the credit reset to run every hour (checks internally if any user is due).
 * Using setInterval instead of a cron library to keep dependencies minimal.
 */
export function startCreditResetScheduler(): void {
  const INTERVAL_MS = 60 * 60 * 1_000 // 1 hour

  // Run immediately on startup to catch any past-due resets
  resetMonthlyCredits()

  setInterval(resetMonthlyCredits, INTERVAL_MS)
  logger.info('Credit reset scheduler started (runs every hour)')
}
