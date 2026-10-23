import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { idField, requireEventOwner, requireIomixoEvent, type CallerAuth } from './guard'
import { eventBrandOf } from './brand'
import { deleteObjects } from '../photos/storage'

export const CONFIG_MAX_BYTES = 16_000
/** Stable IDs of the MIOLOVE screen backgrounds (never paths). MUST match SCREEN_BACKGROUND_IDS in the frontend (lib/miolove/screenBackgrounds.ts; a unit test compares them). */
export const SCREEN_BACKGROUND_THEMES = ['default', 'romantic_pink_bokeh', 'ethereal_pastel_light', 'botanical_green_mist', 'violet_light_ribbons', 'dreamy_champagne_glow'] as const
/** Event fields that are still AUTHORITATIVE in Supabase: the owner's client mirrors them here right after the legacy write. */
export interface MirroredEventFields { title?: string; djName?: string | null; description?: string | null; coupleNames?: string | null; weddingDate?: string | null; venueName?: string | null; status?: 'live' | 'ended' }
export interface UpdateEventConfigInput {
  eventId: string
  screenConfig?: Record<string, unknown> | null
  guestConfig?: Record<string, unknown> | null
  screenModeEnabled?: boolean
  /** Winner-announcement mirror (the legacy route validates/cleans the photos; here it is only a SIGNAL that tells the TV to use the legacy path). */
  winnerAnnouncement?: Record<string, unknown> | null
  /** MIOLOVE table sign: only the owner's overrides of the defaults (null = back to defaults). */
  posterConfig?: PosterConfig | null
  eventFields?: MirroredEventFields
}

export type PosterConfig = Partial<Record<(typeof POSTER_TEXT_FIELDS)[number], string>> & {
  format?: 'A4' | 'A5'; primaryColor?: string; backgroundColor?: string
  titleFont?: string; scriptFont?: string; bodyFont?: string; titleSize?: 's' | 'm' | 'l'
}
const POSTER_TEXT_FIELDS = ['title1', 'title2', 'title3', 'instruction1', 'instruction2', 'displayName', 'displayDate'] as const
const POSTER_TEXT_MAX: Record<(typeof POSTER_TEXT_FIELDS)[number], number> = { title1: 24, title2: 16, title3: 24, instruction1: 60, instruction2: 60, displayName: 80, displayDate: 40 }
const POSTER_ENUMS = {
  format: ['A4', 'A5'], titleSize: ['s', 'm', 'l'],
  titleFont: ['playfair', 'cormorant', 'cinzel', 'inter'], scriptFont: ['greatVibes', 'dancing', 'tangerine'], bodyFont: ['inter', 'cormorant', 'playfair'],
} as const
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** Known keys only; anything invalid is refused (never silently stored). */
export function parsePosterConfig(v: unknown): PosterConfig | null {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpsError('invalid-argument', 'posterConfig must be an object or null', { reason: 'invalid_payload', field: 'posterConfig' })
  const d = v as Record<string, unknown>, out: Record<string, unknown> = {}
  const bad = (k: string) => new HttpsError('invalid-argument', `posterConfig.${k} invalid`, { reason: 'invalid_payload', field: `posterConfig.${k}` })
  for (const k of Object.keys(POSTER_ENUMS) as Array<keyof typeof POSTER_ENUMS>) {
    if (!(k in d) || d[k] === undefined) continue
    if (typeof d[k] !== 'string' || !(POSTER_ENUMS[k] as readonly string[]).includes(d[k] as string)) throw bad(k)
    out[k] = d[k]
  }
  for (const k of ['primaryColor', 'backgroundColor'] as const) {
    if (!(k in d) || d[k] === undefined) continue
    if (typeof d[k] !== 'string' || !HEX_COLOR.test(d[k] as string)) throw bad(k)
    out[k] = d[k]
  }
  for (const k of POSTER_TEXT_FIELDS) {
    if (!(k in d) || d[k] === undefined) continue
    if (typeof d[k] !== 'string' || (d[k] as string).length > POSTER_TEXT_MAX[k]) throw bad(k)
    out[k] = d[k]
  }
  return out as PosterConfig
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
  if ('posterConfig' in d) out.posterConfig = parsePosterConfig(d.posterConfig)
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
  const { ref, data: ownedEvent } = await requireEventOwner(db, request, input.eventId)
  // Screen Mode / winner announcement are live-control settings: not for a MIOLOVE album. The ONE exception is the album's own privacy switch
  // "photos on the screen" (screenConfig.show_photos) and the screen background (screenConfig.backgroundTheme, whitelisted id): a MIOLOVE owner may set
  // those two keys and nothing else of the screen config.
  let albumScreenPatch: { show_photos?: boolean; backgroundTheme?: string } | null = null
  if (input.screenConfig !== undefined || input.winnerAnnouncement !== undefined || input.screenModeEnabled !== undefined) {
    if ((await eventBrandOf(db, ownedEvent)) === 'miolove') {
      const sc = input.screenConfig
      if (input.winnerAnnouncement !== undefined || input.screenModeEnabled !== undefined || !sc || !('show_photos' in sc || 'backgroundTheme' in sc)) await requireIomixoEvent(db, ownedEvent)   // same refusal as before
      albumScreenPatch = {}
      if ('show_photos' in sc!) {
        if (typeof sc!.show_photos !== 'boolean') throw new HttpsError('invalid-argument', 'show_photos must be a boolean', { reason: 'invalid_payload', field: 'show_photos' })
        albumScreenPatch.show_photos = sc!.show_photos
      }
      if ('backgroundTheme' in sc!) {
        if (typeof sc!.backgroundTheme !== 'string' || !(SCREEN_BACKGROUND_THEMES as readonly string[]).includes(sc!.backgroundTheme)) throw new HttpsError('invalid-argument', 'backgroundTheme invalid', { reason: 'invalid_payload', field: 'backgroundTheme' })
        albumScreenPatch.backgroundTheme = sc!.backgroundTheme
      }
    }
  }
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
    if (albumScreenPatch !== null) {
      patch.screenConfig = { ...(curCfg ?? {}), ...albumScreenPatch }          // merge only these keys: the client's other keys are never stored for an album
    } else if (input.screenConfig !== undefined || input.winnerAnnouncement !== undefined) {
      const { winner_announcement: _ignored, ...restCur } = curCfg ?? {}
      void _ignored
      const base = input.screenConfig === undefined ? restCur : input.screenConfig === null ? {} : (({ winner_announcement: _w, ...r }) => (void _w, r))(input.screenConfig)
      const winner = input.winnerAnnouncement !== undefined ? input.winnerAnnouncement : curCfg?.winner_announcement
      patch.screenConfig = input.screenConfig === null && input.winnerAnnouncement === undefined ? null : winner === undefined ? base : { ...base, winner_announcement: winner }
    }
    if (input.guestConfig !== undefined) patch.guestConfig = input.guestConfig
    if (input.screenModeEnabled !== undefined) patch.screenModeEnabled = input.screenModeEnabled
    if (input.posterConfig !== undefined) patch.posterConfig = input.posterConfig
    if (input.eventFields) Object.assign(patch, input.eventFields)
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() })
    return { updated: Object.keys(patch) }
  })
  if (stale.length) await deleteObjects(stale)            // after the commit, best effort (never blocks the owner)
  return result
}
