import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit, Timestamp,
  type Firestore, type DocumentData, type Unsubscribe,
} from 'firebase/firestore'
import type { EventDoc, EventType, EventStatus } from '../models'

// Read-side repository for events/{eventId} and eventSlugs/{slug}.
// There are intentionally NO client write functions: events are written by the
// backend while Supabase is the source of truth (see firestore.rules).

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const TYPES: readonly EventType[] = ['standard', 'party', 'wedding']

export function fromEventDoc(id: string, d: DocumentData): EventDoc {
  const status: EventStatus = d.status === 'ended' ? 'ended' : 'live'
  return {
    id,
    ownerUid:          d.ownerUid,
    legacySupabaseId:  d.legacySupabaseId,
    slug:              d.slug,
    title:             d.title ?? '',
    djName:            d.djName ?? null,
    description:       d.description ?? null,
    type:              TYPES.includes(d.type) ? d.type : 'standard',
    status,
    coupleNames:       d.coupleNames ?? null,
    weddingDate:       d.weddingDate ?? null,
    venueName:         d.venueName ?? null,
    screenModeEnabled: d.screenModeEnabled === true,
    guestConfig:       d.guestConfig ?? null,
    ...('screenConfig' in d ? { screenConfig: d.screenConfig ?? null } : {}),
    createdAt:         toDate(d.createdAt),
    updatedAt:         toDate(d.updatedAt),
  }
}

export async function getEventById(db: Firestore, eventId: string): Promise<EventDoc | null> {
  const snap = await getDoc(doc(db, 'events', eventId))
  return snap.exists() ? fromEventDoc(snap.id, snap.data()) : null
}

/** slug → eventId via eventSlugs/{slug} (a single `get`, never a collection query). */
export async function getEventIdBySlug(db: Firestore, slug: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'eventSlugs', slug))
  return snap.exists() ? (snap.data().eventId as string) : null
}

export async function getEventBySlug(db: Firestore, slug: string): Promise<EventDoc | null> {
  const id = await getEventIdBySlug(db, slug)
  return id ? getEventById(db, id) : null
}

/** Owner's events, newest first. Filters by ownerUid (required by the rules) and is always bounded. */
export async function listOwnerEvents(db: Firestore, ownerUid: string, max = 50): Promise<EventDoc[]> {
  const q = query(collection(db, 'events'), where('ownerUid', '==', ownerUid), orderBy('createdAt', 'desc'), limit(max))
  return (await getDocs(q)).docs.map((d) => fromEventDoc(d.id, d.data()))
}

/** The owner's event projected from a legacy Supabase session (one bounded query; ownerUid filter satisfies the rules). */
export async function getOwnerEventByLegacyId(db: Firestore, ownerUid: string, legacySupabaseId: string): Promise<EventDoc | null> {
  const q = query(collection(db, 'events'), where('ownerUid', '==', ownerUid), where('legacySupabaseId', '==', legacySupabaseId), limit(1))
  const snap = await getDocs(q)
  return snap.empty ? null : fromEventDoc(snap.docs[0].id, snap.docs[0].data())
}

/**
 * Realtime listener on ONE event document. Returns the unsubscribe function, which
 * the caller must invoke on cleanup. `onChange(null)` means the document was deleted.
 */
export function subscribeEvent(
  db: Firestore,
  eventId: string,
  onChange: (event: EventDoc | null) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'events', eventId),
    (snap) => onChange(snap.exists() ? fromEventDoc(snap.id, snap.data()) : null),
    (err) => onError?.(err),
  )
}
