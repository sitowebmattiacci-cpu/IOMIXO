import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { eventRefByLegacySession } from './eventChildProjection'

/**
 * Projection of Supabase `live_game_rounds` (wedding_roulette, shoe_game) into
 *   events/{eventId}/games/{roundId}
 *     { type, status, config, result, legacySupabaseId, sourceUpdatedAt, createdAt, updatedAt }
 * The Firestore document id IS the Supabase row id. `status` keeps the legacy vocabulary (idle | running | completed);
 * `config` / `result` are copied verbatim. Supabase stays authoritative.
 *
 * ORDERING: `sourceUpdatedAt` = live_game_rounds.updated_at (DB clock, microsecond precision) is the version of the row.
 * Every write is a Firestore transaction that compares the incoming version with the stored one:
 *   incoming > stored → apply · incoming == stored → no-op (idempotent) · incoming < stored → ignored as stale.
 * `createdAt` = live_game_rounds.created_at. `updatedAt` is only the time the projection wrote the document.
 * The Node clock is never used as a version: a row without created_at/updated_at is not projected.
 */
export type GameType = 'wedding_roulette' | 'shoe_game'
export type GameStatus = 'idle' | 'running' | 'completed'
export type ProjectResult = 'created' | 'applied' | 'duplicate' | 'stale_ignored' | 'no_event' | 'invalid'

const GAME_TYPES: readonly string[] = ['wedding_roulette', 'shoe_game']
const STATUSES: readonly string[] = ['idle', 'running', 'completed']

export interface LegacyGameRoundRow {
  id: string
  session_id: string
  game_type: string
  status: GameStatus
  config?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/**
 * ISO-8601 (Postgres timestamptz text) → Firestore Timestamp WITHOUT losing the microseconds:
 * `new Date(iso)` would truncate to milliseconds and make two updates within the same ms look equal.
 * Returns null for anything that is not a parseable timestamp.
 */
export function parseSourceTimestamp(iso: unknown): Timestamp | null {
  if (typeof iso !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim())
  if (!m) return null
  const tz = m[3] ? (m[3] === 'Z' ? 'Z' : m[3].length === 3 ? `${m[3]}:00` : m[3].includes(':') ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`) : 'Z'
  const ms = Date.parse(`${m[1].replace(' ', 'T')}${tz}`)
  if (!Number.isFinite(ms)) return null
  return new Timestamp(Math.floor(ms / 1000), Number((m[2] ?? '').padEnd(9, '0')))
}

const cmp = (a: Timestamp, b: Timestamp) => (a.seconds - b.seconds) || (a.nanoseconds - b.nanoseconds)

/**
 * Versioned, transactional upsert of one round. Safe to call concurrently and out of order.
 * Never throws for stale / invalid input; Firestore errors propagate to the (never-throwing) service wrapper.
 */
export async function projectGameRound(row: LegacyGameRoundRow): Promise<ProjectResult> {
  const created = parseSourceTimestamp(row.created_at), version = parseSourceTimestamp(row.updated_at)
  if (!GAME_TYPES.includes(row.game_type) || !STATUSES.includes(row.status) || !created || !version) return 'invalid'
  const eventRef = await eventRefByLegacySession(row.session_id)
  if (!eventRef) return 'no_event'
  const ref = eventRef.collection('games').doc(row.id)

  const result = await eventRef.firestore.runTransaction(async (tx): Promise<ProjectResult> => {
    const snap = await tx.get(ref)
    const stored = snap.exists ? (snap.data()!.sourceUpdatedAt as Timestamp | undefined) : undefined
    if (snap.exists && stored) {
      const c = cmp(version, stored)
      if (c < 0) return 'stale_ignored'
      if (c === 0) return 'duplicate'
    }
    tx.set(ref, {
      type: row.game_type,
      status: row.status,
      config: row.config ?? null,
      result: row.result ?? null,
      legacySupabaseId: row.id,
      sourceUpdatedAt: version,
      createdAt: created,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return snap.exists ? 'applied' : 'created'
  })

  if (result === 'stale_ignored') {
    // Structured, payload-free log.
    console.warn(JSON.stringify({ projection: 'games', result: 'stale_ignored', eventId: eventRef.id, roundId: row.id }))
  }
  return result
}

/** Rows returned by a bulk update (start closes the previous rounds, reset): each one is versioned on its own. */
export async function projectGameRounds(rows: LegacyGameRoundRow[]): Promise<ProjectResult[]> {
  return Promise.all(rows.map((r) => projectGameRound(r)))
}
