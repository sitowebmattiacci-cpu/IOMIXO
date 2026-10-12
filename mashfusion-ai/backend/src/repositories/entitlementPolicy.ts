import type { PlanTier } from '../config/plans'

/**
 * Pure write policy shared by the live projection and the backfill (no I/O, easy to test).
 *
 * EVENT PASS — legacy `event_passes.updated_at` is NOT reliable: the table has no updated_at trigger, so a refund / cancel update
 * keeps the creation timestamp. A pass lifecycle is therefore ranked and the rank is monotonic:
 *     active (0) < expired (1) < refunded (2)
 *   incoming rank > stored rank → apply · lower → stale (never resurrect a revoked pass) · equal → compare versions:
 *   newer → apply, older → stale, tie → noop when the content is identical, apply when it differs.
 *
 * PLAN — `users.updated_at` (trigger-maintained) is the version.
 *   source 'stripe' (Firestore authoritative) is never overwritten · newer → apply · older → stale ·
 *   tie → noop when tier AND source already match, apply otherwise (a client-created 'default' plan becomes 'legacy').
 *   A stored plan WITHOUT a version (set by hand, e.g. the owner) is never downgraded by a backfill: 'protected_downgrade'.
 */
export interface Version { seconds: number; nanoseconds: number }
export const cmpVersion = (a: Version, b: Version) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds)

export type PassStatus = 'active' | 'expired' | 'refunded'
export const PASS_RANK: Record<PassStatus, number> = { active: 0, expired: 1, refunded: 2 }
export type PassDecision = 'create' | 'apply' | 'noop' | 'stale'

export function decidePass(
  stored: { status: PassStatus; version: Version | null } | null,
  incoming: { status: PassStatus; version: Version; sameContent: boolean },
): PassDecision {
  if (!stored) return 'create'
  const dr = PASS_RANK[incoming.status] - PASS_RANK[stored.status]
  if (dr > 0) return 'apply'
  if (dr < 0) return 'stale'
  if (!stored.version) return 'apply'
  const c = cmpVersion(incoming.version, stored.version)
  if (c > 0) return 'apply'
  if (c < 0) return 'stale'
  return incoming.sameContent ? 'noop' : 'apply'
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, wedding: 2 }
export type PlanDecision = 'apply' | 'noop' | 'stale' | 'protected_stripe' | 'protected_downgrade'

export function decidePlan(
  stored: { tier: PlanTier; source: string | null; version: Version | null } | null,
  incoming: { tier: PlanTier; version: Version },
  opts: { allowUnversionedDowngrade?: boolean } = {},
): PlanDecision {
  if (!stored) return 'apply'
  if (stored.source === 'stripe') return 'protected_stripe'
  if (!stored.version) {
    if (stored.source === 'legacy' && TIER_RANK[incoming.tier] < TIER_RANK[stored.tier] && !opts.allowUnversionedDowngrade) return 'protected_downgrade'
    return 'apply'
  }
  const c = cmpVersion(incoming.version, stored.version)
  if (c > 0) return 'apply'
  if (c < 0) return 'stale'
  return stored.tier === incoming.tier && stored.source === 'legacy' ? 'noop' : 'apply'
}
