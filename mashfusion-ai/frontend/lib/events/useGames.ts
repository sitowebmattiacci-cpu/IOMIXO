'use client'
import { useEffect, useMemo, useState } from 'react'
import { getFirebaseDb } from '../firebase/client'
import { onAuthChange } from '../firebase/auth'
import { authProvider } from '../auth'
import { subscribeLatestGame } from '../firebase/repositories/gameRepository'
import { useEventChildSignal } from './useRequests'
import type { GameRoundDoc, GameType } from '../firebase/models'
import type { LiveGameRound } from '../api'

/** Shape the legacy UI already understands (the Firestore doc id is the Supabase row id). */
export function toLegacyRound(g: GameRoundDoc): LiveGameRound {
  return {
    id: g.id, game_type: g.type, status: g.status,
    config: g.config as LiveGameRound['config'], result: g.result as LiveGameRound['result'],
    created_at: (g.createdAt ?? new Date()).toISOString(), updated_at: (g.updatedAt ?? new Date()).toISOString(),
  }
}

export interface LiveGames { roulette: LiveGameRound | null; shoeGame: LiveGameRound | null }

/**
 * Guest / TV / remote: the newest roulette and shoe-game rounds of one event, in realtime (2 one-doc listeners).
 * `undefined` = realtime unavailable (Firebase off, event not projected, rules/index error, not ready yet):
 * the caller keeps its legacy polling. An event whose games were never projected also yields {null,null}
 * on a healthy listener, so callers should prefer the legacy payload when this is empty AND the event has no
 * projected games — see `preferRealtime`.
 */
export function useLatestGames(eventId: string | undefined): LiveGames | undefined {
  const [roulette, setRoulette] = useState<GameRoundDoc | null | undefined>(undefined)
  const [shoe, setShoe] = useState<GameRoundDoc | null | undefined>(undefined)

  useEffect(() => {
    setRoulette(undefined); setShoe(undefined)
    if (!eventId || authProvider() !== 'firebase') return
    let stops: Array<() => void> = []
    const stopAuth = onAuthChange((user) => {
      stops.forEach((s) => s()); stops = []
      if (!user) return
      const db = getFirebaseDb()
      const sub = (type: GameType, set: (g: GameRoundDoc | null | undefined) => void) =>
        subscribeLatestGame(db, eventId, type, set, () => { set(undefined) })
      stops = [sub('wedding_roulette', setRoulette), sub('shoe_game', setShoe)]
    })
    return () => { stopAuth(); stops.forEach((s) => s()) }
  }, [eventId])

  // Memoized so consumers' effects do not re-run on every render.
  return useMemo(() => (roulette === undefined || shoe === undefined
    ? undefined
    : { roulette: roulette && toLegacyRound(roulette), shoeGame: shoe && toLegacyRound(shoe) }), [roulette, shoe])
}

/**
 * Merge helper: realtime wins only when it actually holds a projected round of that game. If the event was never
 * projected for games (flag off, or rounds created before the projection was enabled) the legacy value is kept,
 * so enabling realtime can never hide a round that exists in Supabase.
 */
export const preferRealtime = <T,>(rt: T | null | undefined, legacy: T | null | undefined): T | null => rt ?? legacy ?? null

/** DJ dashboard: change signal for the open event's games; the page re-fetches the legacy API on every tick. */
export const useGamesSignal = (sessionId: string | undefined) => useEventChildSignal(sessionId, (db, eventId, onChange, onError) => {
  const stops = (['wedding_roulette', 'shoe_game'] as const).map((t) => subscribeLatestGame(db, eventId, t, () => onChange(), () => onError()))
  return () => stops.forEach((s) => s())
})
