import {
  collection, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import type { RequestDoc, RequestStatus } from '../models'

// Read-only repository for events/{eventId}/requests. There is no client write: requests
// are created by the createMusicRequest Cloud Function (see firestore.rules).

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const STATUSES: readonly RequestStatus[] = ['pending', 'approved', 'rejected']

export function fromRequestDoc(id: string, d: DocumentData): RequestDoc {
  return {
    id,
    guestUid:  d.guestUid ?? null,
    songTitle: d.songTitle ?? '',
    artist:    d.artist ?? null,
    message:   d.message ?? null,
    status:    STATUSES.includes(d.status) ? d.status : 'pending',
    legacySupabaseId: d.legacySupabaseId,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  }
}

const col = (db: Firestore, eventId: string) => collection(db, 'events', eventId, 'requests')

/** The guest's own requests (rules require the guestUid filter). Bounded. */
const guestQuery = (db: Firestore, eventId: string, guestUid: string, max: number) =>
  query(col(db, eventId), where('guestUid', '==', guestUid), orderBy('createdAt', 'desc'), limit(max))

/** All requests of one event, newest first, bounded — owner only. */
const ownerQuery = (db: Firestore, eventId: string, max: number) =>
  query(col(db, eventId), orderBy('createdAt', 'desc'), limit(max))

export async function listGuestRequests(db: Firestore, eventId: string, guestUid: string, max = 20): Promise<RequestDoc[]> {
  return (await getDocs(guestQuery(db, eventId, guestUid, max))).docs.map((d) => fromRequestDoc(d.id, d.data()))
}

export async function listEventRequests(db: Firestore, eventId: string, max = 200): Promise<RequestDoc[]> {
  return (await getDocs(ownerQuery(db, eventId, max))).docs.map((d) => fromRequestDoc(d.id, d.data()))
}

/** Realtime: the guest's own requests on ONE event. Caller must call the returned unsubscribe. */
export function subscribeGuestRequests(
  db: Firestore, eventId: string, guestUid: string,
  onChange: (requests: RequestDoc[]) => void, onError?: (e: Error) => void, max = 20,
): Unsubscribe {
  return onSnapshot(
    guestQuery(db, eventId, guestUid, max),
    (snap) => onChange(snap.docs.map((d) => fromRequestDoc(d.id, d.data()))),
    (e) => onError?.(e),
  )
}

/** Realtime: all requests of ONE event (owner/DJ). Never subscribe across events. */
export function subscribeEventRequests(
  db: Firestore, eventId: string,
  onChange: (requests: RequestDoc[]) => void, onError?: (e: Error) => void, max = 200,
): Unsubscribe {
  return onSnapshot(
    ownerQuery(db, eventId, max),
    (snap) => onChange(snap.docs.map((d) => fromRequestDoc(d.id, d.data()))),
    (e) => onError?.(e),
  )
}
