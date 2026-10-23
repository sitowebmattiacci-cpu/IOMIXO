// Is a MIOLOVE album closed to GUESTS right now, and why? Pure module (no React). The server says it (`uploads_closed` / `album_phase` of getPublicEvent, its own clock and
// the only authority for uploads); the browser clock only covers the instant an open page crosses an end date.
export type GuestClosureKind = 'trial' | 'pending' | 'expired'
export interface GuestClosure { closed: boolean; kind: GuestClosureKind | null; /** i18n key of the notice shown to guests. */ key: string | null }

interface PublicSessionLike {
  access_mode?: string | null
  trial_expired?: boolean
  trial_expires_at?: string | null
  expires_at?: string | null
  uploads_closed?: boolean
  album_phase?: string | null
}

const KEYS: Record<GuestClosureKind, string> = { trial: 'guestAlbum.trialEnded', pending: 'guestAlbum.notActivated', expired: 'guestAlbum.albumExpired' }
const passed = (iso: string | null | undefined, now: number) => !!iso && now >= Date.parse(iso)

export function guestAlbumClosure(s: PublicSessionLike, isAlbum: boolean, now: number = Date.now()): GuestClosure {
  if (!isAlbum) return { closed: false, kind: null, key: null }
  let kind: GuestClosureKind | null = null
  if (s.access_mode === 'pending' || s.album_phase === 'pending') kind = 'pending'
  else if (s.album_phase === 'expired' || (s.access_mode === 'activated' && passed(s.expires_at, now))) kind = 'expired'
  else if (s.album_phase === 'trial_ended' || s.album_phase === 'trial_lapsed' || (s.access_mode === 'trial' && (s.trial_expired === true || passed(s.trial_expires_at, now)))) kind = 'trial'
  return kind ? { closed: true, kind, key: KEYS[kind] } : { closed: false, kind: null, key: null }
}

/** The TV screen: a pending or expired album does not play as an active one (a paused trial keeps its slideshow). */
export function screenClosedKind(ev: { accessMode?: string | null; expiresAt?: Date | null }, now: number = Date.now()): 'pending' | 'expired' | null {
  if (ev.accessMode === 'pending') return 'pending'
  if (ev.accessMode === 'activated' && ev.expiresAt && ev.expiresAt.getTime() <= now) return 'expired'
  return null
}
