import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { trialExpiresAt } from './trialQuota'

/**
 * Lifecycle of ONE MIOLOVE album. There is no account-level plan: every album carries its own state on events/{eventId}.
 *
 *   accessMode  'trial'      the account's single free trial (7 days, 50 contents), then a 30-day recovery window
 *               'pending'    created, not paid yet ("da attivare"): no uploads, no premium features, no trial
 *               'activated'  paid (webhook only): activatedAt + expiresAt (= activatedAt + 365 days)
 *               'purged'     content deleted for good; the doc is a hidden administrative tombstone
 *   purgeAfter  Timestamp the scheduler looks at: trial → trialExpiresAt + 30 d, activated → expiresAt. One single-field range query finds
 *               everything due, whatever the reason. Absent on pending / purged / legacy albums (which therefore never purge by themselves).
 *
 * Every date is decided on the SERVER clock. Pure module: shared by createPhotoUpload / finalizePhoto / checkout / webhook / purge / public payload.
 */
export const ALBUM_RETENTION_DAYS = 365
export const TRIAL_GRACE_DAYS = 30
const DAY = 86_400_000

export const albumExpiryFrom = (activatedAt: Date): Date => new Date(activatedAt.getTime() + ALBUM_RETENTION_DAYS * DAY)
export const trialPurgeAt = (trialEnd: Date): Date => new Date(trialEnd.getTime() + TRIAL_GRACE_DAYS * DAY)

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
export const albumActivatedAt = (ev: DocumentData): Date | null => toDate(ev.activatedAt)
export const albumExpiresAt = (ev: DocumentData): Date | null => toDate(ev.expiresAt)
export const albumPurgeAfter = (ev: DocumentData): Date | null => toDate(ev.purgeAfter)

export type AlbumPhase =
  | 'trial'          // free trial running
  | 'trial_ended'    // trial over, inside the 30-day window: paused, still purchasable, media kept
  | 'trial_lapsed'   // window over, waiting for the purge: no longer purchasable
  | 'pending'        // created, waiting for payment
  | 'active'         // paid and inside its 365 days (also: paid before the expiry field existed)
  | 'expired'        // paid, 365 days over, waiting for the purge
  | 'purged'

/** null = not a MIOLOVE-lifecycle album (IOMIXO events, legacy albums without accessMode). */
export function albumPhase(ev: DocumentData, now: Date): AlbumPhase | null {
  if (ev.purgedAt || ev.accessMode === 'purged') return 'purged'
  if (ev.accessMode === 'pending') return 'pending'
  if (ev.accessMode === 'activated') {
    const end = albumExpiresAt(ev)
    return end && end.getTime() <= now.getTime() ? 'expired' : 'active'
  }
  if (ev.accessMode === 'trial') {
    const end = trialExpiresAt(ev)
    if (!end || end.getTime() > now.getTime()) return 'trial'               // an older trial album without an end date never expires (no retroactive lock-out)
    return trialPurgeAt(end).getTime() <= now.getTime() ? 'trial_lapsed' : 'trial_ended'
  }
  return null
}

/** Why an album cannot take a NEW upload right now (null = it can). The reasons are the vocabulary the guest pages already know, plus the two new ones. */
export function uploadBlockReason(ev: DocumentData, now: Date): string | null {
  switch (albumPhase(ev, now)) {
    case 'pending': return 'miolove_album_not_activated'
    case 'expired': return 'miolove_album_expired'
    case 'trial_ended': case 'trial_lapsed': return 'miolove_trial_expired'
    case 'purged': return 'event_not_found'
    default: return null
  }
}

/**
 * May a payment activate this album? Only a trial inside its recovery window or a pending one, never one that is being / was purged, deleted, already
 * paid or past its window (an old Checkout Session cannot bring a lapsed album back). Used by BOTH the checkout and the webhook transaction.
 */
export function activationBlockReason(ev: DocumentData, now: Date): string | null {
  if (ev.deletedAt || ev.purge) return 'album_gone'
  const phase = albumPhase(ev, now)
  if (phase === 'active' || phase === 'expired') return 'already_activated'
  if (phase === 'trial' || phase === 'trial_ended' || phase === 'pending') return null
  return 'album_not_eligible'
}

/** Activation fields written by the webhook. `now` is the server clock: the client never takes part. */
export function activationDates(now: Date): { activatedAt: Timestamp; expiresAt: Timestamp; purgeAfter: Timestamp } {
  const end = Timestamp.fromDate(albumExpiryFrom(now))
  return { activatedAt: Timestamp.fromDate(now), expiresAt: end, purgeAfter: end }
}

