import { Timestamp, type DocumentData } from 'firebase-admin/firestore'

/**
 * Contents (photos and videos TOGETHER: 40 photos + 10 videos = 50) a MIOLOVE free-trial album may collect. The only definition: the event also
 * carries it as `trialPhotoLimit` for the UI. The field / constant names say "photo" for historical reasons; they count every content.
 */
export const MIOLOVE_TRIAL_PHOTO_LIMIT = 50
export const MIOLOVE_TRIAL_MEDIA_LIMIT = MIOLOVE_TRIAL_PHOTO_LIMIT
export const TRIAL_PHOTO_LIMIT_REASON = 'miolove_trial_photo_limit_reached'

/** Wedding album created by a couple on the free trial (events without `accessMode` are never trial). */
export const isTrialAlbum = (ev: DocumentData): boolean => ev.type === 'wedding' && ev.accessMode === 'trial'

/** MIOLOVE albums (trial or activated) use the photo flow without the professional entitlement. */
export const hasMiolovePhotoAccess = (ev: DocumentData): boolean => ev.type === 'wedding' && (ev.accessMode === 'trial' || ev.accessMode === 'activated')

export const trialPhotoCount = (ev: DocumentData): number | null =>
  typeof ev.trialPhotoCount === 'number' && ev.trialPhotoCount >= 0 ? ev.trialPhotoCount : null

/** Length of the free MIOLOVE trial. Decided HERE (server clock), written once at creation as trialExpiresAt; the client clock never takes part. */
export const MIOLOVE_TRIAL_DAYS = 7
export const TRIAL_EXPIRED_REASON = 'miolove_trial_expired'

/** End of the trial of a NEW trial album. Albums created before the field existed carry none: they never expire (no retroactive lock-out). */
export const trialExpiryFrom = (start: Date): Date => new Date(start.getTime() + MIOLOVE_TRIAL_DAYS * 86_400_000)
export const trialExpiresAt = (ev: DocumentData): Date | null => (ev.trialExpiresAt instanceof Timestamp ? ev.trialExpiresAt.toDate() : null)

/**
 * A trial that ran out only blocks NEW uploads. Nothing is deleted: the owner keeps reading the album, guests keep seeing the page, and the
 * media stay until an explicit, approved retention policy says otherwise.
 */
export const isTrialExpired = (ev: DocumentData, now: Date): boolean => {
  if (!isTrialAlbum(ev)) return false
  const end = trialExpiresAt(ev)
  return end !== null && end.getTime() <= now.getTime()
}
