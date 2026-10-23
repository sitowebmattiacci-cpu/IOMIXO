// Where ONE MIOLOVE album stands. Pure module (no React): shared by the album list, the billing page, the album page and the unit tests.
//
// There is no account-level plan: every album carries its own state (server-written marks on events/{id}: accessMode, trialExpiresAt, activatedAt, expiresAt). The browser clock is
// only used to DISPLAY days left; what is actually blocked (uploads, checkout, deletion) is decided on the server clock.
import { TRIAL_GRACE_DAYS_UI } from './retention'

export type AlbumStatusKind =
  | 'trial'        // free trial running ("Prova gratuita")
  | 'trialEnded'   // trial over, inside the 30-day recovery window: paused, can still be activated
  | 'pending'      // created, not paid ("Da attivare")
  | 'active'       // paid, inside its 365 days ("Attivo")
  | 'expired'      // paid, 365 days over, waiting for the deletion ("Scaduto")

export interface AlbumStatus {
  kind: AlbumStatusKind
  /** Whole days until the relevant end (trial end / expiresAt / end of the recovery window). null = no date known (older album). */
  daysLeft: number | null
  /** ISO date of that end. */
  until: string | null
  /** Trial usage (contents held / allowed), trial albums only. */
  used: number | null
  limit: number | null
  /** May the owner pay for this album now? */
  canActivate: boolean
}

export interface AlbumLike {
  access_mode?: string | null
  trial_expires_at?: string | null
  trial_photo_count?: number | null
  trial_photo_limit?: number | null
  activated_at?: string | null
  expires_at?: string | null
}

const DAY = 86_400_000
const daysUntil = (iso: string | null | undefined, now: number): number | null => {
  const end = iso ? Date.parse(iso) : NaN
  return Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - now) / DAY))
}
const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * DAY).toISOString()

/** null = not a MIOLOVE-lifecycle album (no accessMode). */
export function albumStatus(album: AlbumLike | null | undefined, now: number = Date.now()): AlbumStatus | null {
  if (!album) return null
  const used = typeof album.trial_photo_count === 'number' ? album.trial_photo_count : null
  const limit = typeof album.trial_photo_limit === 'number' ? album.trial_photo_limit : null
  switch (album.access_mode) {
    case 'pending':
      return { kind: 'pending', daysLeft: null, until: null, used: null, limit: null, canActivate: true }
    case 'activated': {
      const end = album.expires_at ?? null
      const expired = !!end && Date.parse(end) <= now
      return { kind: expired ? 'expired' : 'active', daysLeft: daysUntil(end, now), until: end, used: null, limit: null, canActivate: false }
    }
    case 'trial': {
      const end = album.trial_expires_at ?? null
      if (end && Date.parse(end) <= now) {
        const windowEnd = addDays(end, TRIAL_GRACE_DAYS_UI)
        const open = Date.parse(windowEnd) > now
        return { kind: 'trialEnded', daysLeft: daysUntil(windowEnd, now), until: windowEnd, used, limit, canActivate: open }
      }
      return { kind: 'trial', daysLeft: daysUntil(end, now), until: end, used, limit, canActivate: true }
    }
    default:
      return null
  }
}

/** The albums an owner can still pay for (pending, trial running, trial paused inside its recovery window). */
export const activatableAlbums = <T extends AlbumLike>(albums: T[], now: number = Date.now()): T[] => albums.filter((a) => albumStatus(a, now)?.canActivate)
