// MIOLOVE ALBUM commercial offer. Pure module (no React): shared by the public home, the billing page and the unit tests.
//
// Two offers only: the 7-day free trial and the FULL ALBUM, a single payment of €19.99 (list price €39.99, shown struck through). No subscription, no monthly plan, no Event Pass,
// no IOMIXO plan. A feature is shown to people ONLY if it really exists: every item below points at a `FeatureId`, and the lists skip the ones
// whose status is still 'planned' (audit 2026-10-19, see MIOLOVE_GO_LIVE.md). Flip a status the day the feature ships and the pages follow.
// Media engine shipped: video, original quality and download-everything are 'available'; only the 12-month retention is still planned.

import { currencyForLocale, type Currency } from '../pricing'

export const ALBUM_PRICE_EUR = 19.99
/** Crossed-out list price shown next to the current one. */
export const ALBUM_LIST_PRICE_EUR = 39.99
/**
 * Album price per currency, the single source for every page. EN visitors see dollars (lib/pricing.ts: English → USD, it/fr/es → EUR).
 * DECISION PENDING (owner): the USD figures mirror the euro ones (same convention as the IOMIXO plans in lib/pricing.ts), no FX conversion is
 * computed. Change `usd` here, and the Stripe USD price, if a different dollar amount is wanted.
 */
export const ALBUM_PRICING: Record<'current' | 'list', Record<Currency, number>> = {
  current: { eur: ALBUM_PRICE_EUR, usd: 19.99 },
  list:    { eur: ALBUM_LIST_PRICE_EUR, usd: 39.99 },
}
export const TRIAL_DAYS = 7
export const TRIAL_MEDIA_LIMIT = 50

export type FeatureStatus = 'available' | 'planned'
export type FeatureId =
  | 'photos' | 'video' | 'guests' | 'noApp' | 'qrLink' | 'trial7days' | 'slideshow' | 'basicCustom' | 'brandVisible'
  | 'months12' | 'originalQuality' | 'downloadAll' | 'whiteLabel' | 'posterCard'

export const FEATURE_STATUS: Record<FeatureId, FeatureStatus> = {
  photos: 'available',          // guest photo upload, gallery, moderation, TV slideshow
  video: 'available',           // guest + owner upload of mp4 / mov / webm (max 150 MB each), gallery player, slideshow playback; the trial counts photos + videos together
  guests: 'available',          // no guest cap (only an anti-spam cap per guest)
  noApp: 'available',           // web pages, QR + link
  qrLink: 'available',
  trial7days: 'available',      // trialStartsAt / trialExpiresAt written by createEvent; uploads refused after the end (server clock)
  slideshow: 'available',       // /screen/[slug]: photos play by default on a MIOLOVE album
  basicCustom: 'available',     // names, date, venue, description, occasion
  brandVisible: 'available',    // MIOLOVE mark on guest page / booth / screen of a trial album
  months12: 'planned',          // NOT implemented: no activatedAt / expiresAt, no retention policy
  originalQuality: 'available', // the ORIGINAL file of every new photo / video is stored as sent; the album shows derived copies; download = original
  downloadAll: 'available',     // owner: one click → server-built ZIP of every original (requestAlbumExport / onAlbumExportCreated); locked on the free trial
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

/** €19,99 · $19.99 · 19,99 € — an amount in the visitor's currency and number style (it: €19,99 · en: $19.99 · fr / es: 19,99 €). */
export function formatAlbumAmount(locale: string, amount: number, currency: Currency = currencyForLocale(locale)): string {
  const n = amount.toFixed(2)
  if (currency === 'usd') return `$${n}`
  return locale === 'it' ? `€${n.replace('.', ',')}` : `${n.replace('.', ',')} €`
}

/** The album's current price for this language (EN → dollars, the others → euro). */
export function formatAlbumPrice(locale: string): string {
  const c = currencyForLocale(locale)
  return formatAlbumAmount(locale, ALBUM_PRICING.current[c], c)
}

/** The crossed-out list price (€39,99 / $39.99 / 39,99 €). */
export function formatAlbumListPrice(locale: string): string {
  const c = currencyForLocale(locale)
  return formatAlbumAmount(locale, ALBUM_PRICING.list[c], c)
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
