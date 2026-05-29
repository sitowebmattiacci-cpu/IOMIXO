/** Plan tiers and limits — IOMIXO Live Hub (Free / Pro / Wedding Edition). */

export type PlanTier = 'free' | 'pro' | 'wedding'

/** Legacy credit allocations — kept for the AI engine workflow that is hidden but still
 *  reachable by direct URL. */
export const PLAN_CREDITS: Record<PlanTier, number> = {
  free:    1,
  pro:     20,
  wedding: 100,
}

export interface PlanLimits {
  maxActiveSessions:       number      // Infinity = unlimited
  maxRequestsPerSession:   number
  approveRequests:         boolean
  analytics:               boolean
  profileSocials:          boolean
  customBranding:          'none' | 'reduced' | 'full'
  multiStaff:              boolean
  upcomingEvents:          boolean
  // Wedding Edition features
  weddingMode:             boolean     // can create wedding sessions
  weddingDedications:      boolean
  weddingGames:            boolean     // roulette etc.
  livePolls:               boolean
  guestPhotoAlbum:         boolean
  screenMode:              boolean
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxActiveSessions:     1,
    maxRequestsPerSession: 30,
    approveRequests:       true,
    analytics:             false,
    profileSocials:        false,
    customBranding:        'none',
    multiStaff:            false,
    upcomingEvents:        false,
    weddingMode:           false,
    weddingDedications:    false,
    weddingGames:          false,
    livePolls:             false,
    guestPhotoAlbum:       false,
    screenMode:            false,
  },
  pro: {
    maxActiveSessions:     Number.POSITIVE_INFINITY,
    maxRequestsPerSession: Number.POSITIVE_INFINITY,
    approveRequests:       true,
    analytics:             true,
    profileSocials:        true,
    customBranding:        'reduced',
    multiStaff:            false,
    upcomingEvents:        true,
    weddingMode:           false,
    weddingDedications:    false,
    weddingGames:          false,
    livePolls:             false,
    guestPhotoAlbum:       false,
    screenMode:            false,
  },
  wedding: {
    maxActiveSessions:     Number.POSITIVE_INFINITY,
    maxRequestsPerSession: Number.POSITIVE_INFINITY,
    approveRequests:       true,
    analytics:             true,
    profileSocials:        true,
    customBranding:        'full',
    multiStaff:            true,
    upcomingEvents:        true,
    weddingMode:           true,
    weddingDedications:    true,
    weddingGames:          true,
    livePolls:             true,
    guestPhotoAlbum:       true,
    screenMode:            true,
  },
}

/**
 * Accepts any plan-ish string and returns a valid canonical tier.
 *
 * The Advance tier is stored as 'wedding' in the database for backward
 * compatibility with existing records. UI labels it as "Advance".
 * All legacy aliases (pro_plus, premium_wedding, wedding_edition_plan,
 * club, studio, advance) are collapsed onto 'wedding'.
 */
export function normalizePlan(raw: string | null | undefined): PlanTier {
  if (raw === 'pro') return 'pro'
  if (
    raw === 'wedding' ||
    raw === 'advance' ||
    raw === 'pro_plus' ||
    raw === 'premium_wedding' ||
    raw === 'wedding_edition_plan' ||
    raw === 'club' ||
    raw === 'studio'
  ) return 'wedding'
  return 'free'
}
