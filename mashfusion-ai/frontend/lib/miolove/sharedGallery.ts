// MIOLOVE "Galleria condivisa": may the guests of an album SEE the media other guests shared? Pure module (no React / Firebase).
// Stored as guestConfig.shared_gallery on the event. Absent, false or anything but a real `true` = off: every album starts closed. The rules in
// firebase/firestore.rules and firebase/storage.rules apply the same test on the server, so hiding the UI is never the only protection.
export const SHARED_GALLERY_KEY = 'shared_gallery'
export const sharedGalleryOn = (guestConfig: unknown): boolean =>
  typeof guestConfig === 'object' && guestConfig !== null && !Array.isArray(guestConfig) && (guestConfig as Record<string, unknown>)[SHARED_GALLERY_KEY] === true
