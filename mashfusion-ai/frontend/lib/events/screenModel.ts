import type { EventDoc, DedicationDoc } from '../firebase/models'
import type { LivePollState } from './usePolls'
import { toLegacyPoll } from './usePolls'
import type { LiveGames } from './useGames'
import type { ScreenPayload, LiveDedication, LivePhoto } from '../api'
import type { WinnerUrls } from './usePhotos'

/**
 * Pure model of the TV screen read path from Firestore (no React, no I/O) so every rule is unit-tested.
 *
 * `legacyReason` (name kept) says why the TV cannot be shown:
 *   no_event / not_screen_type   the event does not exist, or is a standard session
 *   screen_not_allowed           plan does not allow screen mode (or the gate could not be checked)
 *   pending                      realtime data (photos / winner URLs / games) is still loading
 * A missing config is an empty screen; legacy (non `events/`) winner paths are ignored: Firebase is the only data source.
 */
export type LegacyReason = 'no_event' | 'not_screen_type' | 'screen_not_allowed'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the photo-bearing sections need besides the event: realtime approved photos and the resolved winner URLs (undefined = still loading). */
export interface ScreenExtras { photos?: LivePhoto[]; winnerUrls?: WinnerUrls | null }

const firebasePath = (v: unknown) => typeof v === 'string' && v.startsWith('events/')
const hasFirebaseWinnerPath = (w: Record<string, unknown>) => firebasePath(w.groom_photo_path) || firebasePath(w.bride_photo_path)

export function screenEligibility(
  event: EventDoc | null, screenAllowed: boolean | null, games: LiveGames | undefined, extras: ScreenExtras = {},
): { ok: true; config: Record<string, unknown> } | { ok: false; legacyReason: LegacyReason | 'pending' } {
  if (!event) return { ok: false, legacyReason: 'no_event' }
  if (event.type !== 'party' && event.type !== 'wedding') return { ok: false, legacyReason: 'not_screen_type' }
  const cfg = isObject(event.screenConfig) ? event.screenConfig : {}
  if (screenAllowed === null) return { ok: false, legacyReason: 'pending' }
  if (screenAllowed === false) return { ok: false, legacyReason: 'screen_not_allowed' }
  if (cfg.show_photos === true && extras.photos === undefined) return { ok: false, legacyReason: 'pending' }
  const w = cfg.winner_announcement
  if (isObject(w) && hasFirebaseWinnerPath(w) && extras.winnerUrls === undefined) return { ok: false, legacyReason: 'pending' }
  if ((cfg.show_roulette === true || cfg.show_shoe_game === true) && games === undefined) return { ok: false, legacyReason: 'pending' }
  return { ok: true, config: cfg }
}

export function composeScreenPayload(
  event: EventDoc, cfg: Record<string, unknown>, poll: LivePollState | null | undefined, games: LiveGames | undefined, dedications: DedicationDoc[] | null,
  extras: ScreenExtras = {},
): ScreenPayload {
  const winner = isObject(cfg.winner_announcement) ? cfg.winner_announcement : null
  const screenConfig = winner
    ? { ...cfg, winner_announcement: { ...winner, groom_photo_url: extras.winnerUrls?.groom ?? null, bride_photo_url: extras.winnerUrls?.bride ?? null } }
    : cfg
  const wall: LiveDedication[] = (dedications ?? []).slice(0, 6).map((d) => ({
    id: d.id, guest_name: d.senderName, message: d.message, status: 'approved', created_at: (d.createdAt ?? new Date()).toISOString(),
  }))
  return {
    session: {
      event_name: event.title, dj_name: event.djName, session_type: event.type, couple_names: event.coupleNames,
      wedding_date: event.weddingDate, venue_name: event.venueName, is_active: event.status === 'live',
      screen_config: screenConfig as ScreenPayload['session']['screen_config'],
    },
    roulette:    cfg.show_roulette === true && games?.roulette?.result ? games.roulette : null,
    shoe_game:   cfg.show_shoe_game === true ? games?.shoeGame ?? null : null,
    active_poll: cfg.show_polls === true && poll ? (toLegacyPoll(poll) as ScreenPayload['active_poll']) : null,
    dedications: cfg.show_dedications === true ? wall : [],
    photos:      cfg.show_photos === true ? (extras.photos ?? []).slice(0, 12) : [],
  }
}
