import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { firestore } from '../lib/firebaseAdmin'

/**
 * Server-side repository for events/{eventId} + eventSlugs/{slug} (Admin SDK).
 *
 * TRANSITION: Supabase `live_sessions` is still the source of truth (child domains
 * reference it). This repository maintains a one-way Firestore PROJECTION of it,
 * keyed by `legacySupabaseId`. Clients never write events (see firestore.rules).
 */

export type EventType   = 'standard' | 'party' | 'wedding'
export type EventStatus = 'live' | 'ended'

/** The Supabase live_sessions columns the projection needs. */
export interface LegacySessionRow {
  id:           string
  public_slug:  string
  event_name:   string
  dj_name?:     string | null
  description?: string | null
  is_active:    boolean
  session_type?: string | null
  couple_names?: string | null
  wedding_date?: string | null
  venue_name?:  string | null
  screen_mode_enabled?: boolean | null
  guest_config?: Record<string, unknown> | null
  created_at?:  string
  dj_id?:       string
}

/** Server-computed values stored on the event (never accepted from clients). */
export interface EventServerFields {
  /** Max requests per session for the DJ's EFFECTIVE plan; null = unlimited. Used by createMusicRequest. */
  requestLimit?: number | null
  /** Party/Wedding session whose DJ has Advance or an active Event Pass (legacy hasEventAccess). Used by createDedication. */
  dedicationsEnabled?: boolean
}

export class EventConflictError extends Error {}

const events = () => firestore().collection('events')
const slugs  = () => firestore().collection('eventSlugs')

const TYPES: readonly EventType[] = ['standard', 'party', 'wedding']

/** Pure mapping, kept separate for unit testing. ownerUid / slug / createdAt are handled by the caller. */
export function toEventFields(row: LegacySessionRow) {
  return {
    title:             row.event_name,
    djName:            row.dj_name ?? null,
    description:       row.description ?? null,
    type:              (TYPES as readonly string[]).includes(row.session_type ?? '') ? row.session_type as EventType : 'standard',
    status:            (row.is_active ? 'live' : 'ended') as EventStatus,
    coupleNames:       row.couple_names ?? null,
    weddingDate:       row.wedding_date ?? null,
    venueName:         row.venue_name ?? null,
    screenModeEnabled: row.screen_mode_enabled ?? false,
    guestConfig:       row.guest_config ?? null,
  }
}

async function findByLegacyId(legacyId: string) {
  const q = await events().where('legacySupabaseId', '==', legacyId).limit(1).get()
  return q.empty ? null : q.docs[0]
}

/**
 * Create or update the projection of one legacy session.
 * - ownerUid is set once, at creation; a different owner on update is rejected.
 * - slug uniqueness is guaranteed by creating eventSlugs/{slug} in the same batch
 *   (create() fails if it exists) → EventConflictError.
 */
export async function upsertEventFromLegacy(ownerUid: string, row: LegacySessionRow, server: EventServerFields = {}): Promise<string> {
  const existing = await findByLegacyId(row.id)

  if (existing) {
    if (existing.data().ownerUid !== ownerUid) throw new EventConflictError('Event belongs to another owner')
    await existing.ref.update({ ...toEventFields(row), ...server, updatedAt: FieldValue.serverTimestamp() })
    return existing.id
  }

  const ref = events().doc()
  const batch = firestore().batch()
  batch.create(slugs().doc(row.public_slug), { eventId: ref.id })
  batch.create(ref, {
    ownerUid,
    legacySupabaseId: row.id,
    slug: row.public_slug,
    ...toEventFields(row),
    ...server,
    createdAt: row.created_at ? Timestamp.fromDate(new Date(row.created_at)) : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  try {
    await batch.commit()
  } catch (e) {
    if ((e as { code?: number }).code === 6) throw new EventConflictError(`Slug already in use: ${row.public_slug}`)
    throw e
  }
  return ref.id
}

export async function deleteEventByLegacyId(ownerUid: string, legacyId: string): Promise<void> {
  const existing = await findByLegacyId(legacyId)
  if (!existing || existing.data().ownerUid !== ownerUid) return
  // Deleting a session cascades in Supabase; mirror that here: the event, ALL its subcollections
  // (requests, dedications, polls, votes, tally, anti-spam helpers...) and the slug mapping.
  await slugs().doc(existing.data().slug).delete()
  await firestore().recursiveDelete(existing.ref)
}

export async function getEventIdBySlug(slug: string): Promise<string | null> {
  const s = await slugs().doc(slug).get()
  return s.exists ? (s.data()!.eventId as string) : null
}
