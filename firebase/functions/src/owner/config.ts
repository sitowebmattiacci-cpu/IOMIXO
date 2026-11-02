import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { idField, requireEventOwner, requireIomixoEvent, type CallerAuth } from './guard'
import { eventBrandOf } from './brand'
import { deleteObjects, revokeDownloadToken, type TokenRevocation } from '../photos/storage'
import { ownedPaths } from '../photos/media'

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
/** guestConfig.shared_gallery decides whether guests of a MIOLOVE album may SEE the shared photos / videos (firestore.rules + storage.rules read it): only a real boolean is stored. */
const checkGuestConfig = (v: Record<string, unknown> | null): Record<string, unknown> | null => {
  if (v && 'shared_gallery' in v && typeof v.shared_gallery !== 'boolean') throw new HttpsError('invalid-argument', 'shared_gallery must be a boolean', { reason: 'invalid_payload', field: 'shared_gallery' })
  return v
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
  if ('guestConfig' in d) out.guestConfig = checkGuestConfig(plainObject(d.guestConfig, 'guestConfig'))
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

export async function updateEventConfig(db: Firestore, request: CallerAuth, input: UpdateEventConfigInput): Promise<{ updated: string[]; galleryRevocation?: GalleryRevocation }> {
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
  const miolove = input.guestConfig !== undefined && (await eventBrandOf(db, ownedEvent)) === 'miolove'
  let revokeEpoch: number | null = null                  // set when the links of a MIOLOVE album must be (re)closed after the commit
  const result = await db.runTransaction(async (tx) => {
    stale.length = 0
    revokeEpoch = null
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
    if (input.guestConfig !== undefined) {
      patch.guestConfig = input.guestConfig
      if (miolove) {
        const was = (cur.guestConfig as Record<string, unknown> | null | undefined)?.shared_gallery === true
        const on = input.guestConfig?.shared_gallery === true
        const epoch = typeof cur.galleryEpoch === 'number' ? cur.galleryEpoch : 0
        if (was && !on) { patch.galleryEpoch = epoch + 1; revokeEpoch = epoch + 1 }                                   // ON → OFF: a new revocation round
        else if (!on && (cur.galleryRevocation as { state?: string } | undefined)?.state === 'incomplete') revokeEpoch = epoch    // OFF → OFF: resume what is left
        if (on && !was) patch.galleryRevocation = FieldValue.delete()                                                  // open again: nothing pending
      }
    }
    if (input.screenModeEnabled !== undefined) patch.screenModeEnabled = input.screenModeEnabled
    if (input.posterConfig !== undefined) patch.posterConfig = input.posterConfig
    if (input.eventFields) Object.assign(patch, input.eventFields)
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() })
    return { updated: Object.keys(patch).filter((k) => k !== 'galleryEpoch' && k !== 'galleryRevocation') }
  })
  if (stale.length) await deleteObjects(stale)            // after the commit, best effort (never blocks the owner)
  if (revokeEpoch !== null) return { ...result, galleryRevocation: await revokeGalleryLinks(db, input.eventId, revokeEpoch) }
  return result
}

/** Outcome of closing the links already handed out. `incomplete` = some approved photos still have a link that may work: the owner's switch is OFF anyway (the rules), but the revocation is NOT done. */
export interface GalleryRevocation { state: 'complete' | 'incomplete'; epoch: number; pending: number; failed: number }
/** Stays under the callable's 60 s default with room for the last in-flight photos and the final writes. */
export const REVOKE_BUDGET_MS = 35_000
const REVOKE_WORKERS = 12

/**
 * "Galleria condivisa" went ON → OFF: the rules already refuse new reads, but a Firebase download URL carries a token that works without the rules, so every
 * link handed out while the gallery was open is killed by replacing the token of each approved photo's files (original, optimized copy, thumbnail / poster).
 *
 * Reliable for any album size: it is RESUMABLE and HONEST. A photo whose files were all revoked is marked `linksRevokedEpoch = epoch` (the epoch grows on every
 * ON → OFF), so a later call only does what is left; it stops starting photos after `budgetMs`; it counts failures; and it returns `incomplete` (and stores that
 * on the event) until every approved photo is done. A missing file counts as done (nothing can serve it). Never claims more than it did.
 */
export async function revokeGalleryLinks(
  db: Firestore, eventId: string, epoch: number,
  opts: { budgetMs?: number; revoke?: (path: string) => Promise<TokenRevocation>; now?: () => number } = {},
): Promise<GalleryRevocation> {
  const revoke = opts.revoke ?? revokeDownloadToken, now = opts.now ?? Date.now
  const deadline = now() + (opts.budgetMs ?? REVOKE_BUDGET_MS)
  const snap = await db.collection(`events/${eventId}/photos`).where('status', '==', 'approved').get()
  const todo = snap.docs.filter((d) => d.data().linksRevokedEpoch !== epoch)
  let next = 0, done = 0, failed = 0
  await Promise.all(Array.from({ length: Math.min(REVOKE_WORKERS, todo.length) }, async () => {
    while (next < todo.length && now() < deadline) {
      const doc = todo[next++]
      const results = await Promise.all(ownedPaths(doc.data()).map(revoke))
      if (results.includes('failed')) { failed++; continue }
      try { await doc.ref.update({ linksRevokedEpoch: epoch }); done++ } catch (e) { failed++; console.error('[revokeGalleryLinks] mark failed', (e as Error).message) }
    }
  }))
  const pending = todo.length - done
  const out: GalleryRevocation = { state: pending === 0 ? 'complete' : 'incomplete', epoch, pending, failed }
  await db.doc(`events/${eventId}`).update({ galleryRevocation: { ...out, updatedAt: FieldValue.serverTimestamp() } }).catch((e) => console.error('[revokeGalleryLinks] state write failed', (e as Error).message))
  return out
}
