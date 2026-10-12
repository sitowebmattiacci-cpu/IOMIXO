import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { idField, requireEventOwner, type CallerAuth } from './guard'

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
export async function updateEventConfig(db: Firestore, request: CallerAuth, input: UpdateEventConfigInput): Promise<{ updated: string[] }> {
  const { ref } = await requireEventOwner(db, request, input.eventId)
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data()!
    const patch: Record<string, unknown> = {}
    const curCfg = cur.screenConfig as Record<string, unknown> | null | undefined
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
}
