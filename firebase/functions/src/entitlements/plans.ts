/**
 * Plan tiers and limits. MIRROR of mashfusion-ai/backend/src/config/plans.ts (the Functions package cannot import the backend).
 * A backend test (planParity.test.ts) fails if the two tables ever drift. Delete the backend copy with Render.
 * The Advance tier is stored as 'wedding'; every legacy alias collapses onto it (see normalizePlan).
 */
export type PlanTier = 'free' | 'pro' | 'wedding'

export interface PlanLimits {
  maxActiveSessions:       number      // Infinity = unlimited
  maxRequestsPerSession:   number
  approveRequests:         boolean
  analytics:               boolean
  profileSocials:          boolean
  customBranding:          'none' | 'reduced' | 'full'
  multiStaff:              boolean
  upcomingEvents:          boolean
  weddingMode:             boolean
  weddingDedications:      boolean
  weddingGames:            boolean
  livePolls:               boolean
  guestPhotoAlbum:         boolean
  screenMode:              boolean
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    maxActiveSessions: 1, maxRequestsPerSession: 30, approveRequests: true, analytics: false, profileSocials: false,
    customBranding: 'none', multiStaff: false, upcomingEvents: false, weddingMode: false, weddingDedications: false,
    weddingGames: false, livePolls: false, guestPhotoAlbum: false, screenMode: false,
  },
  pro: {
    maxActiveSessions: Number.POSITIVE_INFINITY, maxRequestsPerSession: Number.POSITIVE_INFINITY, approveRequests: true, analytics: true,
    profileSocials: true, customBranding: 'reduced', multiStaff: false, upcomingEvents: true, weddingMode: false,
    weddingDedications: false, weddingGames: false, livePolls: false, guestPhotoAlbum: false, screenMode: false,
  },
  wedding: {
    maxActiveSessions: Number.POSITIVE_INFINITY, maxRequestsPerSession: Number.POSITIVE_INFINITY, approveRequests: true, analytics: true,
    profileSocials: true, customBranding: 'full', multiStaff: true, upcomingEvents: true, weddingMode: true,
    weddingDedications: true, weddingGames: true, livePolls: true, guestPhotoAlbum: true, screenMode: true,
  },
}

/** Any plan-ish string → canonical tier (same mapping as the legacy backend). */
export function normalizePlan(raw: string | null | undefined): PlanTier {
  if (raw === 'pro') return 'pro'
  if (raw === 'wedding' || raw === 'advance' || raw === 'pro_plus' || raw === 'premium_wedding'
      || raw === 'wedding_edition_plan' || raw === 'club' || raw === 'studio') return 'wedding'
  return 'free'
}
