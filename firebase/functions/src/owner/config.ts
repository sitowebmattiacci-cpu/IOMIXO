import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { idField, requireEventOwner, type CallerAuth } from './guard'
import { deleteObjects } from '../photos/storage'

export const CONFIG_MAX_BYTES = 16_000
/** Event fields that are still AUTHORITATIVE in Supabase: the owner's client mirrors them here right after the legacy write. */
export interface MirroredEventFields { title?: string; djName?: string | null; description?: string | null; coupleNames?: string | null; weddingDate?: string | null; venueName?: string | null; status?: 'live' | 'ended' }
export interface UpdateEventConfigInput {
  eventId: string
  screenConfig?: Record<string, unknown> | null
  guestConfig?: Record<string, unknown> | null
  screenModeEnabled?: boolean
  /** Winner-announcement mirror (the legacy route validates/cleans the photos; here it is only a SIGNAL that tells the TV to use the legacy path). */
  winnerAnnouncement?: Record<string, unknown> | null
  eventFields?: MirroredEventFields
}

const plainObject = (v: unknown, field: string): Record<string, unknown> | null => {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpsError('invalid-argument', `${field} must be an object or null`, { reason: 'invalid_payload', field })
  if (JSON.stringify(v).length > CONFIG_MAX_BYTES) throw new HttpsError('invalid-argument', `${field} too large`, { reason: 'invalid_payload', field })
  return v as Record<string, unknown>
}
const textField = (v: unknown, field: string, max: number, nullable: boolean): string | null => {
  if (v === null && nullable) return null
  if (typeof v !== 'string' || v.length > max || (!nullable && v.trim() === '')) throw new HttpsError('invalid-argument', `${field} invalid`, { reason: 'invalid_payload', field })
  return v
}

const TEXT_LIMITS = { title: 200, djName: 120, description: 2000, coupleNames: 200, weddingDate: 32, venueName: 200 } as const
function parseEventFields(raw: unknown): MirroredEventFields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpsError('invalid-argument', 'eventFields must be an object', { reason: 'invalid_payload', field: 'eventFields' })
  const d = raw as Record<string, unknown>, out: MirroredEventFields = {}
  if ('title' in d) out.title = textField(d.title, 'title', TEXT_LIMITS.title, false)!
  for (const k of ['djName', 'description', 'coupleNames', 'weddingDate', 'venueName'] as const) if (k in d) out[k] = textField(d[k], k, TEXT_LIMITS[k], true)
  if ('status' in d) {
    if (d.status !== 'live' && d.status !== 'ended') throw new HttpsError('invalid-argument', 'status invalid', { reason: 'invalid_payload', field: 'status' })
    out.status = d.status
  }
  return out
}

/** Only these owner-editable settings are accepted; anything else in the payload is ignored. */
export function parseConfigInput(data: unknown): UpdateEventConfigInput {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const out: UpdateEventConfigInput = { eventId: idField(d.eventId, 'eventId') }
  if ('screenConfig' in d) out.screenConfig = plainObject(d.screenConfig, 'screenConfig')
  if ('guestConfig' in d) out.guestConfig = plainObject(d.guestConfig, 'guestConfig')
  if ('winnerAnnouncement' in d) out.winnerAnnouncement = plainObject(d.winnerAnnouncement, 'winnerAnnouncement')
  if ('screenModeEnabled' in d) {
    if (typeof d.screenModeEnabled !== 'boolean') throw new HttpsError('invalid-argument', 'screenModeEnabled must be a boolean', { reason: 'invalid_payload', field: 'screenModeEnabled' })
    out.screenModeEnabled = d.screenModeEnabled
  }
  if ('eventFields' in d) out.eventFields = parseEventFields(d.eventFields)
  if (Object.keys(out).length === 1) throw new HttpsError('invalid-argument', 'nothing to update', { reason: 'invalid_payload' })
  return out
}

/**
 * Owner edits the settings the TV screen and the guest page read from the event document.
 * `screenConfig.winner_announcement` is NEVER taken from `screenConfig`: it carries Storage paths (photo upload is not migrated), so the stored
 * value is preserved unless the client sends `winnerAnnouncement` (mirror of what the legacy route just validated and saved).
 */
const WINNER_PHOTO_KEYS = ['groom_photo_path', 'bride_photo_path'] as const
const winnerPrefix = (eventId: string) => `events/${eventId}/winner/`
/**
 * Winner photo paths: null, UNCHANGED from what is stored, a path inside THIS event's winner folder, or — for a legacy-backed event only — a path inside
 * its legacy session folder (`${supabaseId}/…`: what the legacy route validates and the client then mirrors here as a signal while Supabase is still in
 * charge; it can only point into that event's own folder). Anything else (another event, a guest photo, `..`) is refused.
 */
function checkWinnerPaths(eventId: string, legacyId: string | null, next: Record<string, unknown> | null, stored: Record<string, unknown> | null | undefined) {
  if (!next) return
  for (const k of WINNER_PHOTO_KEYS) {
    const v = next[k]
    if (v === null || v === undefined || v === stored?.[k]) continue
    const inLegacyFolder = legacyId !== null && typeof v === 'string' && v.startsWith(`${legacyId}/`)
    if (typeof v !== 'string' || !(v.startsWith(winnerPrefix(eventId)) || inLegacyFolder) || v.includes('..') || v.length > 300) {
      throw new HttpsError('invalid-argument', `${k} invalid for this event`, { reason: 'invalid_payload', field: k })
    }
  }
}

export async function updateEventConfig(db: Firestore, request: CallerAuth, input: UpdateEventConfigInput): Promise<{ updated: string[] }> {
  const { ref } = await requireEventOwner(db, request, input.eventId)
  const stale: string[] = []
  const result = await db.runTransaction(async (tx) => {
    stale.length = 0
    const cur = (await tx.get(ref)).data()!
    const patch: Record<string, unknown> = {}
    const curCfg = cur.screenConfig as Record<string, unknown> | null | undefined
    if (input.winnerAnnouncement !== undefined) {
      const storedWinner = (curCfg?.winner_announcement ?? null) as Record<string, unknown> | null
      checkWinnerPaths(input.eventId, typeof cur.legacySupabaseId === 'string' && cur.legacySupabaseId ? cur.legacySupabaseId : null, input.winnerAnnouncement, storedWinner)
      // Replaced / removed Firebase winner photos are deleted after the commit (legacy paths are never touched here).
      for (const k of WINNER_PHOTO_KEYS) {
        const old = storedWinner?.[k]
        if (typeof old === 'string' && old.startsWith(winnerPrefix(input.eventId)) && old !== input.winnerAnnouncement?.[k]) stale.push(old)
      }
    }
    if (input.screenConfig !== undefined || input.winnerAnnouncement !== undefined) {
      const { winner_announcement: _ignored, ...restCur } = curCfg ?? {}
      void _ignored
      const base = input.screenConfig === undefined ? restCur : input.screenConfig === null ? {} : (({ winner_announcement: _w, ...r }) => (void _w, r))(input.screenConfig)
      const winner = input.winnerAnnouncement !== undefined ? input.winnerAnnouncement : curCfg?.winner_announcement
      patch.screenConfig = input.screenConfig === null && input.winnerAnnouncement === undefined ? null : winner === undefined ? base : { ...base, winner_announcement: winner }
    }
    if (input.guestConfig !== undefined) patch.guestConfig = input.guestConfig
    if (input.screenModeEnabled !== undefined) patch.screenModeEnabled = input.screenModeEnabled
    if (input.eventFields) Object.assign(patch, input.eventFields)
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() })
    return { updated: Object.keys(patch) }
  })
  if (stale.length) await deleteObjects(stale)            // after the commit, best effort (never blocks the owner)
  return result
}
