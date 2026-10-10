import { projectChildCreated, projectChildStatus, projectChildDeleted, type ChildSpec } from './eventChildProjection'

/**
 * Projection of Supabase `live_dedications` into events/{eventId}/dedications/{id}.
 * No counter (the product has no event-wide dedication cap) and no guestUid on the document.
 */
export type DedicationStatus = 'pending' | 'approved' | 'rejected'

export interface LegacyDedicationRow {
  id: string
  session_id: string
  guest_name?: string | null
  message: string
  status?: DedicationStatus
  created_at?: string
}

const SPEC: ChildSpec = { collection: 'dedications' }

export const projectDedicationCreated = (row: LegacyDedicationRow) =>
  projectChildCreated(SPEC, row.session_id, row.id, {
    senderName: row.guest_name ?? null,
    message: row.message,
    status: row.status ?? 'pending',
  }, row.created_at)

export const projectDedicationStatus = (sessionId: string, legacyId: string, status: DedicationStatus) =>
  projectChildStatus(SPEC, sessionId, legacyId, status)

export const projectDedicationDeleted = (sessionId: string, legacyId: string) =>
  projectChildDeleted(SPEC, sessionId, legacyId)
