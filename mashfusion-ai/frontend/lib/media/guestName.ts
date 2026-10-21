// Optional guest name of a MIOLOVE album upload. Pure + a tiny per-event localStorage memory: no account, nothing leaves the browser except the
// name sent with each file. Pure module (unit-tested).

export const GUEST_NAME_MAX = 40
const KEY = (slug: string) => `miolove.guestName.${slug}`

/** Trimmed, control characters removed, inner whitespace collapsed, cut to GUEST_NAME_MAX. Empty → undefined (the album shows "Anonimo"). */
export function cleanGuestName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const v = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return v ? Array.from(v).slice(0, GUEST_NAME_MAX).join('').trim() : undefined
}

/** What the album prints on a media card: the guest's name, or the localized "Anonimo" for an empty / legacy one. */
export const displayGuestName = (name: string | null | undefined, anonymous: string): string => cleanGuestName(name) ?? anonymous

/** Name remembered for THIS event (slug) in this browser; another event never inherits it. */
export function loadGuestName(slug: string): string {
  try { return cleanGuestName(window.localStorage.getItem(KEY(slug))) ?? '' } catch { return '' }
}
export function saveGuestName(slug: string, name: string): void {
  try {
    const v = cleanGuestName(name)
    if (v) window.localStorage.setItem(KEY(slug), v); else window.localStorage.removeItem(KEY(slug))
  } catch { /* private mode: the name simply is not remembered */ }
}
