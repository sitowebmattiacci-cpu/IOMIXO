import { projectChildCreated, projectChildStatus, projectChildDeleted, type ChildSpec } from './eventChildProjection'

/**
 * Projection of Supabase `live_requests` into events/{eventId}/requests/{id}.
 * Created either by the createMusicRequest Cloud Function (guestUid set) or by this projection of the
 * legacy route (guestUid null).
 */
export type RequestStatus = 'pending' | 'approved' | 'rejected'

export interface LegacyRequestRow {
  id: string
  session_id: string
  track_title: string
  artist?: string | null
  message?: string | null
  status?: RequestStatus
  created_at?: string
}

const SPEC: ChildSpec = { collection: 'requests', counter: 'requests' }

export const projectRequestCreated = (row: LegacyRequestRow) =>
  projectChildCreated(SPEC, row.session_id, row.id, {
    guestUid: null,
    songTitle: row.track_title,
    artist: row.artist ?? null,
    message: row.message ?? null,
    status: row.status ?? 'pending',
  }, row.created_at)

export const projectRequestStatus = (sessionId: string, legacyId: string, status: RequestStatus) =>
  projectChildStatus(SPEC, sessionId, legacyId, status)

export const projectRequestDeleted = (sessionId: string, legacyId: string) =>
  projectChildDeleted(SPEC, sessionId, legacyId)
