import {
  collection, getDocs, onSnapshot, query, where, orderBy, limit, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import type { GameRoundDoc, GameStatus, GameType } from '../models'

// Read-only repository for events/{eventId}/games (projected from the legacy live_game_rounds; no client writes).

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const TYPES: readonly GameType[] = ['wedding_roulette', 'shoe_game']
const STATUSES: readonly GameStatus[] = ['idle', 'running', 'completed']

export function fromGameDoc(id: string, d: DocumentData): GameRoundDoc | null {
  if (!TYPES.includes(d.type)) return null
  return {
    id,
    type:   d.type,
    status: STATUSES.includes(d.status) ? d.status : 'idle',
    config: d.config ?? null,
    result: d.result ?? null,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

const col = (db: Firestore, eventId: string) => collection(db, 'events', eventId, 'games')

/** The newest round of one game type — what the legacy `/public/:slug/games` returns (limit 1, created_at desc). */
export function subscribeLatestGame(
  db: Firestore, eventId: string, type: GameType,
  onChange: (round: GameRoundDoc | null) => void, onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(query(col(db, eventId), where('type', '==', type), orderBy('createdAt', 'desc'), limit(1)),
    (snap) => onChange(snap.empty ? null : fromGameDoc(snap.docs[0].id, snap.docs[0].data())),
    (e) => onError?.(e))
}

/** One-shot read of the newest round (DJ dashboard actions return it right after a callable). */
export async function getLatestGame(db: Firestore, eventId: string, type: GameType): Promise<GameRoundDoc | null> {
  const snap = await getDocs(query(col(db, eventId), where('type', '==', type), orderBy('createdAt', 'desc'), limit(1)))
  return snap.empty ? null : fromGameDoc(snap.docs[0].id, snap.docs[0].data())
}
