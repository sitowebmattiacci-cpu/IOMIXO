import type { EventDoc, DedicationDoc } from '../firebase/models'
import type { LivePollState } from './usePolls'
import { toLegacyPoll } from './usePolls'
import type { LiveGames } from './useGames'
import type { ScreenPayload, LiveDedication, LivePhoto } from '../api'
import type { WinnerUrls } from './usePhotos'

/**
 * Pure model of the TV screen read path from Firestore (no React, no I/O) so every fallback rule is unit-tested.
 *
 * The Firestore screen is used ONLY when it can show EXACTLY what the legacy payload would. Otherwise `legacyReason` says why and the page keeps
 * the legacy 1.5 s polling. Reasons (all explicit, never a crash):
 *   no_event / not_screen_type   the event is not in Firestore, or is a standard session (legacy answers 400 for those)
 *   no_config                    `screenConfig` missing / null / not an object → never migrated; legacy knows the toggles
 *   screen_not_allowed           plan does not allow screen mode (legacy answers 402) or the gate could not be checked
 *   photos                       show_photos=true on a LEGACY-backed event whose photos were not migrated yet (`photosMigratedAt` missing): the legacy
 *                                payload holds photos Firestore does not know. Native events and migrated ones serve photos from Firestore + Storage.
 *   winner                       the winner announcement still points at LEGACY Storage paths (not `events/…`): only the legacy signed URLs show them
 *   games_pending                roulette/shoe is shown but Firestore has no round for it (games are not backfilled: legacy holds the history)
 */
export type LegacyReason = 'no_event' | 'not_screen_type' | 'no_config' | 'screen_not_allowed' | 'photos' | 'winner' | 'games_pending'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the photo-bearing sections need besides the event: realtime approved photos and the resolved winner URLs (undefined = still loading). */
export interface ScreenExtras { photos?: LivePhoto[]; winnerUrls?: WinnerUrls | null }

const firebasePath = (v: unknown) => typeof v === 'string' && v.startsWith('events/')
const hasLegacyWinnerPath = (w: Record<string, unknown>) =>
  [w.groom_photo_path, w.bride_photo_path].some((p) => typeof p === 'string' && p.length > 0 && !firebasePath(p))
const hasFirebaseWinnerPath = (w: Record<string, unknown>) => firebasePath(w.groom_photo_path) || firebasePath(w.bride_photo_path)

export function screenEligibility(
  event: EventDoc | null, screenAllowed: boolean | null, games: LiveGames | undefined, extras: ScreenExtras = {},
): { ok: true; config: Record<string, unknown> } | { ok: false; legacyReason: LegacyReason | 'pending' } {
  if (!event) return { ok: false, legacyReason: 'no_event' }
  if (event.type !== 'party' && event.type !== 'wedding') return { ok: false, legacyReason: 'not_screen_type' }
  const cfg = event.screenConfig
  if (!isObject(cfg)) return { ok: false, legacyReason: 'no_config' }
  if (screenAllowed === null) return { ok: false, legacyReason: 'pending' }
  if (screenAllowed === false) return { ok: false, legacyReason: 'screen_not_allowed' }
  if (cfg.show_photos === true) {
    if (event.legacySupabaseId && !event.photosMigratedAt) return { ok: false, legacyReason: 'photos' }
    if (extras.photos === undefined) return { ok: false, legacyReason: 'pending' }                       // realtime list not ready (or failed → grace timeout → legacy)
  }
  const w = cfg.winner_announcement
  if (isObject(w)) {
    if (hasLegacyWinnerPath(w)) return { ok: false, legacyReason: 'winner' }
    if (hasFirebaseWinnerPath(w) && extras.winnerUrls === undefined) return { ok: false, legacyReason: 'pending' }
  } else if (w !== null && w !== undefined && w !== false) return { ok: false, legacyReason: 'winner' }  // unknown shape: let the legacy payload decide
  if ((cfg.show_roulette === true || cfg.show_shoe_game === true) && games === undefined) return { ok: false, legacyReason: 'pending' }
  if ((cfg.show_roulette === true && !games?.roulette) || (cfg.show_shoe_game === true && !games?.shoeGame)) return { ok: false, legacyReason: 'games_pending' }
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
