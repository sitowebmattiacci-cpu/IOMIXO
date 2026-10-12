import type { EventDoc, DedicationDoc } from '../firebase/models'
import type { LivePollState } from './usePolls'
import { toLegacyPoll } from './usePolls'
import type { LiveGames } from './useGames'
import type { ScreenPayload, LiveDedication } from '../api'

/**
 * Pure model of the TV screen read path from Firestore (no React, no I/O) so every fallback rule is unit-tested.
 *
 * The Firestore screen is used ONLY when it can show EXACTLY what the legacy payload would. Otherwise `legacyReason` says why and the page keeps
 * the legacy 1.5 s polling. Reasons (all explicit, never a crash):
 *   no_event / not_screen_type   the event is not in Firestore, or is a standard session (legacy answers 400 for those)
 *   no_config                    `screenConfig` missing / null / not an object → never migrated; legacy knows the toggles
 *   screen_not_allowed           plan does not allow screen mode (legacy answers 402) or the gate could not be checked
 *   photos                       show_photos=true → photos need Storage signed URLs (legacy only)
 *   winner                       a winner announcement exists (names + Storage photos rendered from legacy signed URLs)
 *   games_pending                roulette/shoe is shown but Firestore has no round for it (games are not backfilled: legacy holds the history)
 */
export type LegacyReason = 'no_event' | 'not_screen_type' | 'no_config' | 'screen_not_allowed' | 'photos' | 'winner' | 'games_pending'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function screenEligibility(
  event: EventDoc | null, screenAllowed: boolean | null, games: LiveGames | undefined,
): { ok: true; config: Record<string, unknown> } | { ok: false; legacyReason: LegacyReason | 'pending' } {
  if (!event) return { ok: false, legacyReason: 'no_event' }
  if (event.type !== 'party' && event.type !== 'wedding') return { ok: false, legacyReason: 'not_screen_type' }
  const cfg = event.screenConfig
  if (!isObject(cfg)) return { ok: false, legacyReason: 'no_config' }
  if (screenAllowed === null) return { ok: false, legacyReason: 'pending' }
  if (screenAllowed === false) return { ok: false, legacyReason: 'screen_not_allowed' }
  if (cfg.show_photos === true) return { ok: false, legacyReason: 'photos' }
  const w = cfg.winner_announcement
  if (w !== null && w !== undefined && w !== false) return { ok: false, legacyReason: 'winner' }       // any winner object, not only photo paths
  if ((cfg.show_roulette === true || cfg.show_shoe_game === true) && games === undefined) return { ok: false, legacyReason: 'pending' }
  if ((cfg.show_roulette === true && !games?.roulette) || (cfg.show_shoe_game === true && !games?.shoeGame)) return { ok: false, legacyReason: 'games_pending' }
  return { ok: true, config: cfg }
}

export function composeScreenPayload(
  event: EventDoc, cfg: Record<string, unknown>, poll: LivePollState | null | undefined, games: LiveGames | undefined, dedications: DedicationDoc[] | null,
): ScreenPayload {
  const wall: LiveDedication[] = (dedications ?? []).slice(0, 6).map((d) => ({
    id: d.id, guest_name: d.senderName, message: d.message, status: 'approved', created_at: (d.createdAt ?? new Date()).toISOString(),
  }))
  return {
    session: {
      event_name: event.title, dj_name: event.djName, session_type: event.type, couple_names: event.coupleNames,
      wedding_date: event.weddingDate, venue_name: event.venueName, is_active: event.status === 'live',
      screen_config: cfg as ScreenPayload['session']['screen_config'],
    },
    roulette:    cfg.show_roulette === true && games?.roulette?.result ? games.roulette : null,
    shoe_game:   cfg.show_shoe_game === true ? games?.shoeGame ?? null : null,
    active_poll: cfg.show_polls === true && poll ? (toLegacyPoll(poll) as ScreenPayload['active_poll']) : null,
    dedications: cfg.show_dedications === true ? wall : [],
    photos:      [],
  }
}
