import {
  collection, onSnapshot, query, where, orderBy, limit, getDocs, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import type { DedicationDoc, DedicationStatus } from '../models'

// Read-only repository for events/{eventId}/dedications. Writes happen in the createDedication
// Cloud Function / backend projection (see firestore.rules).

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const STATUSES: readonly DedicationStatus[] = ['pending', 'approved', 'rejected']

export function fromDedicationDoc(id: string, d: DocumentData): DedicationDoc {
  return {
    id,
    senderName: d.senderName ?? null,
    message:    d.message ?? '',
    status:     STATUSES.includes(d.status) ? d.status : 'pending',
    legacySupabaseId: d.legacySupabaseId,
    createdAt:  toDate(d.createdAt),
    updatedAt:  toDate(d.updatedAt),
  }
}

const col = (db: Firestore, eventId: string) => collection(db, 'events', eventId, 'dedications')

/** The public wall: approved dedications, newest first, bounded (the rules require the status filter). */
const approvedQuery = (db: Firestore, eventId: string, max: number) =>
  query(col(db, eventId), where('status', '==', 'approved'), orderBy('createdAt', 'desc'), limit(max))

/** Every dedication of one event — owner only. */
const ownerQuery = (db: Firestore, eventId: string, max: number) =>
  query(col(db, eventId), orderBy('createdAt', 'desc'), limit(max))

export async function listApprovedDedications(db: Firestore, eventId: string, max = 50): Promise<DedicationDoc[]> {
  return (await getDocs(approvedQuery(db, eventId, max))).docs.map((d) => fromDedicationDoc(d.id, d.data()))
}
export async function listEventDedications(db: Firestore, eventId: string, max = 200): Promise<DedicationDoc[]> {
  return (await getDocs(ownerQuery(db, eventId, max))).docs.map((d) => fromDedicationDoc(d.id, d.data()))
}

/** Realtime wall for guests (one event, limit 50). Caller must call the returned unsubscribe. */
export function subscribeApprovedDedications(
  db: Firestore, eventId: string, onChange: (items: DedicationDoc[]) => void, onError?: (e: Error) => void, max = 50,
): Unsubscribe {
  return onSnapshot(approvedQuery(db, eventId, max),
    (snap) => onChange(snap.docs.map((d) => fromDedicationDoc(d.id, d.data()))), (e) => onError?.(e))
}

/** Realtime for the DJ (one event, limit 200). */
export function subscribeEventDedications(
  db: Firestore, eventId: string, onChange: (items: DedicationDoc[]) => void, onError?: (e: Error) => void, max = 200,
): Unsubscribe {
  return onSnapshot(ownerQuery(db, eventId, max),
    (snap) => onChange(snap.docs.map((d) => fromDedicationDoc(d.id, d.data()))), (e) => onError?.(e))
}
