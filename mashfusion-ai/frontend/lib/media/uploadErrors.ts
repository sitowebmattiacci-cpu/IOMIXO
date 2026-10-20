// Server / local upload refusals → the i18n key of the message the person reads (IT / EN / FR / ES live in locales). One table for every upload UI.
export const UPLOAD_ERROR_KEYS: Record<string, string> = {
  miolove_trial_expired: 'guestAlbum.trialEnded',
  miolove_trial_photo_limit_reached: 'guestAlbum.limitReached',
  cooldown: 'guestAlbum.err.cooldown',
  guest_limit: 'guestAlbum.err.guestLimit',
  file_too_large: 'guestAlbum.err.tooLarge',
  video_too_large: 'guestAlbum.err.videoTooLarge',
  unsupported_format: 'guestAlbum.err.format',
  upload_missing: 'guestAlbum.err.retry',
  invalid_upload: 'guestAlbum.err.retry',
  event_ended: 'booth.sessionEnded',
}
/** Reasons for which trying the same file again can never work (or would only repeat the refusal): the UI offers "remove", not "retry". */
export const FINAL_UPLOAD_REASONS = new Set(['unsupported_format', 'file_too_large', 'video_too_large', 'miolove_trial_expired', 'miolove_trial_photo_limit_reached', 'event_ended'])
/** Reasons that close the whole album for this guest: the rest of the queue is stopped with the same message. */
export const ALBUM_CLOSED_REASONS = new Set(['miolove_trial_expired', 'miolove_trial_photo_limit_reached', 'event_ended'])
