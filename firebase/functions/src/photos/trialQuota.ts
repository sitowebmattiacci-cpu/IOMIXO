import type { DocumentData } from 'firebase-admin/firestore'

/** Photos a MIOLOVE free-trial album may collect. The only definition: the event also carries it as `trialPhotoLimit` for the UI. */
export const MIOLOVE_TRIAL_PHOTO_LIMIT = 50
export const TRIAL_PHOTO_LIMIT_REASON = 'miolove_trial_photo_limit_reached'

/** Wedding album created by a couple on the free trial (events without `accessMode` are never trial). */
export const isTrialAlbum = (ev: DocumentData): boolean => ev.type === 'wedding' && ev.accessMode === 'trial'

/** MIOLOVE albums (trial or activated) use the photo flow without the professional entitlement. */
export const hasMiolovePhotoAccess = (ev: DocumentData): boolean => ev.type === 'wedding' && (ev.accessMode === 'trial' || ev.accessMode === 'activated')

export const trialPhotoCount = (ev: DocumentData): number | null =>
  typeof ev.trialPhotoCount === 'number' && ev.trialPhotoCount >= 0 ? ev.trialPhotoCount : null
