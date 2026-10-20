// MIOLOVE ALBUM commercial offer. Pure module (no React): shared by the public home, the billing page and the unit tests.
//
// Two offers only: the 7-day free trial and the FULL ALBUM, a single payment of €19.99. No subscription, no monthly plan, no Event Pass,
// no IOMIXO plan. A feature is shown to people ONLY if it really exists: every item below points at a `FeatureId`, and the lists skip the ones
// whose status is still 'planned' (audit 2026-10-19, see MIOLOVE_GO_LIVE.md). Flip a status the day the feature ships and the pages follow.

export const ALBUM_PRICE_EUR = 19.99
export const TRIAL_DAYS = 7
export const TRIAL_MEDIA_LIMIT = 50

export type FeatureStatus = 'available' | 'planned'
export type FeatureId =
  | 'photos' | 'video' | 'guests' | 'noApp' | 'qrLink' | 'trial7days' | 'slideshow' | 'basicCustom' | 'brandVisible'
  | 'months12' | 'originalQuality' | 'downloadAll' | 'whiteLabel' | 'posterCard'

export const FEATURE_STATUS: Record<FeatureId, FeatureStatus> = {
  photos: 'available',          // guest photo upload, gallery, moderation, TV slideshow
  video: 'planned',             // NOT implemented: uploads are jpg / png / webp only (createPhotoUpload, storage rules, UI)
  guests: 'available',          // no guest cap (only an anti-spam cap per guest)
  noApp: 'available',           // web pages, QR + link
  qrLink: 'available',
  trial7days: 'available',      // trialStartsAt / trialExpiresAt written by createEvent; uploads refused after the end (server clock)
  slideshow: 'available',       // /screen/[slug]: photos play by default on a MIOLOVE album
  basicCustom: 'available',     // names, date, venue, description, occasion
  brandVisible: 'available',    // MIOLOVE mark on guest page / booth / screen of a trial album
  months12: 'planned',          // NOT implemented: no activatedAt / expiresAt, no retention policy
  originalQuality: 'planned',   // NOT implemented: photos are resized (1920px, JPEG 82%) in the browser before upload, 8 MB hard cap
  downloadAll: 'planned',       // NOT implemented: only per-photo downloads (a ZIP / server export is missing)
  whiteLabel: 'available',      // an `activated` album shows no MIOLOVE mark (guest page, booth, screen)
  posterCard: 'available',      // poster / QR card editor, locked unless the album is `activated`
}

export interface PlanItem {
  /** i18n key under `albumPlan.f.` */
  key: string
  /** Shown only if this feature is available. */
  feature?: FeatureId
  /** Hidden as soon as this feature is available (the shorter "photos only" wording is replaced by the "photos and videos" one). */
  unless?: FeatureId
}

export const TRIAL_INCLUDED: PlanItem[] = [
  { key: 'trialQuotaPhotos', feature: 'photos', unless: 'video' },
  { key: 'trialQuotaMedia', feature: 'video' },
  { key: 'guests', feature: 'guests' },
  { key: 'noApp', feature: 'noApp' },
  { key: 'qrLink', feature: 'qrLink' },
  { key: 'trialDays', feature: 'trial7days' },
  { key: 'slideshow', feature: 'slideshow' },
  { key: 'basicCustom', feature: 'basicCustom' },
  { key: 'brandVisible', feature: 'brandVisible' },
]
export const TRIAL_EXCLUDED: PlanItem[] = [
  { key: 'noPoster', feature: 'posterCard' },
  { key: 'noDownloadAll', feature: 'downloadAll' },
  { key: 'noWhiteLabel', feature: 'whiteLabel' },
]
export const ALBUM_INCLUDED: PlanItem[] = [
  { key: 'albumMediaPhotos', feature: 'photos', unless: 'video' },
  { key: 'albumMedia', feature: 'video' },
  { key: 'guests', feature: 'guests' },
  { key: 'noApp', feature: 'noApp' },
  { key: 'qrLink', feature: 'qrLink' },
  { key: 'months12Upload', feature: 'months12' },
  { key: 'months12Storage', feature: 'months12' },
  { key: 'originalQuality', feature: 'originalQuality' },
  { key: 'downloadAll', feature: 'downloadAll' },
  { key: 'slideshow', feature: 'slideshow' },
  { key: 'noBrand', feature: 'whiteLabel' },
  { key: 'poster', feature: 'posterCard' },
  { key: 'allIncluded' },
]

export const isFeatureAvailable = (f: FeatureId | undefined, status: Record<FeatureId, FeatureStatus> = FEATURE_STATUS): boolean => !f || status[f] === 'available'

/** The items a visitor may be shown today. */
export function visibleItems(list: PlanItem[], status: Record<FeatureId, FeatureStatus> = FEATURE_STATUS): PlanItem[] {
  return list.filter((i) => isFeatureAvailable(i.feature, status) && !(i.unless && status[i.unless] === 'available'))
}

/** €19,99 / €19.99 / 19,99 € — the amount in the visitor's language. */
export function formatAlbumPrice(locale: string, amount: number = ALBUM_PRICE_EUR): string {
  const n = amount.toFixed(2)
  if (locale === 'en') return `€${n}`
  if (locale === 'it') return `€${n.replace('.', ',')}`
  return `${n.replace('.', ',')} €`
}

/** Words that must never appear in any MIOLOVE surface (they belong to the IOMIXO product). Used by the tests. */
export const MIOLOVE_FORBIDDEN_COPY = /Event\s*Pass|Advance|Pro\s*DJ|IOMIXO|\/\s*mese|al mese|per month|\/\s*month|par mois|\/\s*mes\b|al mes|abbonament|subscription|abonnement|suscripci|upgrade|mise à niveau|mejorar plan|19,99\s*\/|7,99|€\s*7[.,]99/i

// ── Where an album stands ────────────────────────────────────────────────────
export type AlbumPlanKind = 'none' | 'trial' | 'trialEnded' | 'active'
export interface AlbumPlanState { kind: AlbumPlanKind; daysLeft: number | null; used: number | null; limit: number | null }

interface AlbumLike { access_mode?: string | null; trial_expires_at?: string | null; trial_photo_count?: number | null; trial_photo_limit?: number | null }

/**
 * Plan of the owner's album from the SERVER marks only (accessMode, trialExpiresAt): the browser clock is used to display the days left, never to
 * grant anything. A trial without an end date (album created before the field) is an open trial; an unknown mode is not "active".
 */
export function albumPlanState(album: AlbumLike | null | undefined, now: number = Date.now()): AlbumPlanState {
  if (!album) return { kind: 'none', daysLeft: null, used: null, limit: null }
  if (album.access_mode === 'activated') return { kind: 'active', daysLeft: null, used: null, limit: null }
  const used = typeof album.trial_photo_count === 'number' ? album.trial_photo_count : null
  const limit = typeof album.trial_photo_limit === 'number' ? album.trial_photo_limit : null
  const end = album.trial_expires_at ? Date.parse(album.trial_expires_at) : NaN
  const daysLeft = Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / 86_400_000))
  if (album.access_mode === 'trial') return { kind: daysLeft === 0 ? 'trialEnded' : 'trial', daysLeft, used, limit }
  return { kind: 'none', daysLeft: null, used: null, limit: null }
}
