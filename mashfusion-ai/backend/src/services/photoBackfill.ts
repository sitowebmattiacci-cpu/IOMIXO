import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { parseSourceTimestamp } from '../repositories/gameRoundRepository'
import { maskId, BackfillRefused } from './entitlementBackfill'

/**
 * Backfill of the legacy photo domain into Firestore:  live_photos (+ vote counts) → events/{eventId}/photos/{legacyPhotoId}  (METADATA ONLY).
 *
 *  - DRY RUN is the default; nothing is written unless `apply: true` (guards re-checked before the first write; demo project or --yes-production).
 *  - Events are matched by events.legacySupabaseId (the events backfill must have run). A photo whose session has no event is reported and skipped.
 *  - The Firestore doc id IS the legacy photo id → idempotent: an existing doc is never overwritten (a differing one is reported as `drift`).
 *  - The BINARY is not touched: `storagePath` stays '' (the dashboard / TV / guest page skip photos without a served file) and the legacy bucket path is kept
 *    in `legacyStoragePath`. Copying the files is a separate, explicit step (see PHOTO_BINARY_MIGRATION.md; `buildBinaryManifest` below only PLANS it).
 *  - `photosMigratedAt` on the event is set ONLY when there is nothing to copy for it (no legacy photo, no legacy winner photo), so the TV can serve it from
 *    Firestore; events with legacy files keep using the legacy payload until their binaries are copied.
 *  - Nothing is ever deleted by a run. The rollback removes only docs this run created, only if still untouched.
 */
export interface LegacyPhotoRow {
  id: string; session_id: string; guest_name?: string | null; caption?: string | null; storage_path: string
  status: 'pending' | 'approved' | 'rejected'; source?: string | null; is_featured?: boolean | null; created_at: string; updated_at?: string | null
}
export interface PhotoSnapshotSession { id: string; dj_id?: string | null; public_slug?: string | null; session_type?: string | null; show_photos?: boolean | null; winner_announcement?: Record<string, unknown> | null }
export interface PhotoSnapshot { photos: LegacyPhotoRow[]; votes: Array<{ photo_id: string; count: number }>; sessions: PhotoSnapshotSession[] }

export interface PhotoInventory {
  photos: number; sessionsWithPhotos: number; byStatus: Record<string, number>; bySource: Record<string, number>; featured: number; byExtension: Record<string, number>
  duplicateIds: number; missingPath: number; unsafePath: number; invalidTimestamps: number
  votesTotal: number; photosWithVotes: number
  sessionsWithWinner: number; winnerPhotoFiles: number; sessionsShowingPhotos: number; orphanPhotos: number
}
const STATUSES = ['pending', 'approved', 'rejected']
const EXT = /\.([A-Za-z0-9]{1,5})$/
const extOf = (p: string) => (EXT.exec(p)?.[1] ?? '').toLowerCase()
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const unsafe = (p: string) => !p || p.startsWith('/') || p.includes('..') || p.length > 300
const winnerPaths = (w: Record<string, unknown> | null | undefined) => (['groom_photo_path', 'bride_photo_path'] as const).flatMap((k) => (typeof w?.[k] === 'string' && w[k] ? [{ role: k === 'groom_photo_path' ? 'groom' as const : 'bride' as const, path: w[k] as string }] : []))

/** Pure statistics of an export (no Firestore, no identifiers). */
export function inventoryPhotos(snap: PhotoSnapshot): PhotoInventory {
  const inc = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
  const inv: PhotoInventory = { photos: snap.photos.length, sessionsWithPhotos: 0, byStatus: {}, bySource: {}, featured: 0, byExtension: {}, duplicateIds: 0, missingPath: 0, unsafePath: 0,
    invalidTimestamps: 0, votesTotal: 0, photosWithVotes: 0, sessionsWithWinner: 0, winnerPhotoFiles: 0, sessionsShowingPhotos: 0, orphanPhotos: 0 }
  const ids = new Set<string>(), sessions = new Set<string>(), known = new Set(snap.sessions.map((s) => s.id))
  for (const p of snap.photos) {
    inc(inv.byStatus, STATUSES.includes(p.status) ? p.status : `invalid:${p.status}`); inc(inv.bySource, p.source === 'live_booth' ? 'live_booth' : 'guest_upload')
    if (p.is_featured) inv.featured++
    inc(inv.byExtension, extOf(p.storage_path) || '∅')
    if (ids.has(p.id)) inv.duplicateIds++; ids.add(p.id); sessions.add(p.session_id)
    if (!p.storage_path) inv.missingPath++; else if (unsafe(p.storage_path)) inv.unsafePath++
    if (!parseSourceTimestamp(p.created_at)) inv.invalidTimestamps++
    if (!known.has(p.session_id)) inv.orphanPhotos++
  }
  inv.sessionsWithPhotos = sessions.size
  for (const v of snap.votes) { inv.votesTotal += v.count; if (v.count > 0) inv.photosWithVotes++ }
  for (const s of snap.sessions) {
    if (s.show_photos) inv.sessionsShowingPhotos++
    const w = winnerPaths(s.winner_announcement)
    if (w.length) { inv.sessionsWithWinner++; inv.winnerPhotoFiles += w.length }
  }
  return inv
}

export interface PhotoBackfillOptions { apply: boolean; projectId: string; yesProduction?: boolean; limit?: number; legacyUserId?: string }
export interface PhotoBackfillReport {
  mode: 'dry-run' | 'apply'; project: string; inventory: PhotoInventory
  photos: { read: number; selected: number; invalid: number; duplicates: number; unmappedSession: number; ambiguousSession: number; wouldCreate: number; noop: number; drift: number }
  events: { withLegacyPhotos: number; wouldMarkMigrated: number; keptOnLegacy: number }
  binaries: { photoFilesToCopy: number; winnerFilesToCopy: number }
  blockers: string[]; samples: Array<Record<string, unknown>>
  applied?: { written: number; skipped: number }
  entries?: Array<{ path: string; kind: 'photo' | 'eventMarker' }>
}

type EventRef = { id: string; ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }
async function eventsBySession(db: Firestore, sessionIds: string[]): Promise<{ map: Map<string, EventRef>; ambiguous: Set<string> }> {
  const map = new Map<string, EventRef>(), ambiguous = new Set<string>()
  for (const sid of sessionIds) {
    const q = await db.collection('events').where('legacySupabaseId', '==', sid).limit(2).get()
    if (q.size === 1) map.set(sid, { id: q.docs[0].id, ref: q.docs[0].ref, data: q.docs[0].data() }); else if (q.size > 1) ambiguous.add(sid)
  }
  return { map, ambiguous }
}

export function photoDocFields(r: LegacyPhotoRow, votes: number) {
  const created = parseSourceTimestamp(r.created_at)!
  return {
    guestUid: null, guestName: r.guest_name ?? null, caption: r.caption ?? null,
    source: r.source === 'live_booth' ? 'live_booth' : 'guest_upload', status: r.status, isFeatured: r.is_featured === true,
    storagePath: '', legacyStoragePath: r.storage_path, legacySupabaseId: r.id, contentType: MIME[extOf(r.storage_path)] ?? null, size: null,
    ...(votes > 0 ? { legacyVoteCount: votes } : {}), backfilled: true, createdAt: created,
  }
}

export async function runPhotoBackfill(input: PhotoSnapshot, opts: PhotoBackfillOptions, deps: { db: Firestore }): Promise<PhotoBackfillReport> {
  const guard = (bag: string[]) => {
    if (!opts.projectId) bag.push('project id not explicit')
    if (!(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) bag.push('non-emulator project requires --yes-production')
  }
  if (opts.apply) { const early: string[] = []; guard(early); if (early.length) throw new BackfillRefused(early) }
  const { db } = deps
  const report: PhotoBackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', project: opts.projectId, inventory: inventoryPhotos(input),
    photos: { read: input.photos.length, selected: 0, invalid: 0, duplicates: 0, unmappedSession: 0, ambiguousSession: 0, wouldCreate: 0, noop: 0, drift: 0 },
    events: { withLegacyPhotos: 0, wouldMarkMigrated: 0, keptOnLegacy: 0 }, binaries: { photoFilesToCopy: 0, winnerFilesToCopy: 0 }, blockers: [], samples: [],
  }
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]))
  let rows = input.photos
  if (opts.legacyUserId) rows = rows.filter((r) => sessionById.get(r.session_id)?.dj_id === opts.legacyUserId)
  if (opts.limit !== undefined) rows = rows.slice(0, opts.limit)
  report.photos.selected = rows.length

  const idCount = new Map<string, number>(); for (const r of input.photos) idCount.set(r.id, (idCount.get(r.id) ?? 0) + 1)
  const votes = new Map(input.votes.map((v) => [v.photo_id, v.count]))
  const usable: LegacyPhotoRow[] = []
  for (const r of rows) {
    if (!r.id || !r.session_id || !STATUSES.includes(r.status) || !r.storage_path || unsafe(r.storage_path) || !parseSourceTimestamp(r.created_at)) { report.photos.invalid++; continue }
    if ((idCount.get(r.id) ?? 0) > 1) { report.photos.duplicates++; continue }
    usable.push(r)
  }
  if (report.photos.duplicates) report.blockers.push(`${report.photos.duplicates} photo(s) with a duplicate legacy id in the input`)

  // sessions in scope = those with a selected photo, or every snapshot session for the "nothing to copy" marker (restricted by --legacy-user-id)
  const scopeSessions = new Set(usable.map((r) => r.session_id))
  for (const s of input.sessions) if (!opts.legacyUserId || s.dj_id === opts.legacyUserId) scopeSessions.add(s.id)
  const { map: evs, ambiguous } = await eventsBySession(db, Array.from(scopeSessions))

  const planned: Array<() => Promise<'written' | 'skipped'>> = [], entries: NonNullable<PhotoBackfillReport['entries']> = []
  const perEvent = new Map<string, number>()
  for (const r of usable) {
    const ev = evs.get(r.session_id)
    if (!ev) { if (ambiguous.has(r.session_id)) report.photos.ambiguousSession++; else report.photos.unmappedSession++; continue }
    perEvent.set(ev.id, (perEvent.get(ev.id) ?? 0) + 1)
    const ref = ev.ref.collection('photos').doc(r.id), cur = await ref.get(), fields = photoDocFields(r, votes.get(r.id) ?? 0)
    report.binaries.photoFilesToCopy++
    if (cur.exists) {
      const c = cur.data()!
      if (c.status !== fields.status || c.isFeatured !== fields.isFeatured || c.legacyStoragePath !== fields.legacyStoragePath) report.photos.drift++; else report.photos.noop++
      continue
    }
    report.photos.wouldCreate++
    if (report.samples.length < 10) report.samples.push({ photo: maskId(r.id), session: maskId(r.session_id), status: r.status, source: fields.source, ext: extOf(r.storage_path) })
    planned.push(async () => {
      try { await ref.create({ ...fields, updatedAt: FieldValue.serverTimestamp() }) } catch { return 'skipped' as const }       // exists (race / rerun): never overwritten
      entries.push({ path: ref.path, kind: 'photo' }); return 'written' as const
    })
  }
  report.events.withLegacyPhotos = perEvent.size

  for (const sid of scopeSessions) {
    const ev = evs.get(sid); if (!ev) continue
    const s = sessionById.get(sid), legacyWinner = winnerPaths(s?.winner_announcement).filter((w) => !w.path.startsWith('events/'))
    report.binaries.winnerFilesToCopy += legacyWinner.length
    const hasLegacyFiles = (perEvent.get(ev.id) ?? 0) > 0 || legacyWinner.length > 0 || input.photos.some((p) => p.session_id === sid)
    if (ev.data.photosMigratedAt) continue
    if (hasLegacyFiles) { report.events.keptOnLegacy++; continue }
    report.events.wouldMarkMigrated++
    planned.push(async () => {
      const snap = await ev.ref.get(); if (!snap.exists || snap.data()!.photosMigratedAt) return 'skipped' as const
      await ev.ref.update({ photosMigratedAt: FieldValue.serverTimestamp() }); entries.push({ path: ev.ref.path, kind: 'eventMarker' }); return 'written' as const
    })
  }

  if (report.photos.ambiguousSession) report.blockers.push(`${report.photos.ambiguousSession} photo(s) belong to a session matching more than one event`)
  if (report.photos.unmappedSession) report.blockers.push(`${report.photos.unmappedSession} photo(s) belong to a session with no event in Firestore (run the events backfill first)`)
  if (report.inventory.unsafePath || report.inventory.missingPath) report.blockers.push(`${report.inventory.unsafePath + report.inventory.missingPath} photo(s) with a missing/unsafe storage path`)
  if (opts.apply) {
    const reasons = [...report.blockers]; guard(reasons)
    if (reasons.length) throw new BackfillRefused(reasons)
    let written = 0, skipped = 0
    for (const w of planned) { (await w()) === 'written' ? written++ : skipped++ }
    report.applied = { written, skipped }; report.entries = entries
  }
  return report
}

/** Removes ONLY what an apply created: photo docs that are still untouched (backfilled, no served file) and markers it set. */
export async function runPhotoRollback(db: Firestore, entries: Array<{ path: string; kind: 'photo' | 'eventMarker' }>, opts: { apply: boolean; projectId: string; yesProduction?: boolean }) {
  if (opts.apply && !(opts.projectId.startsWith('demo-') || opts.yesProduction === true)) throw new BackfillRefused(['non-emulator project requires --yes-production'])
  const out = { removed: 0, skippedChanged: 0 }
  for (const e of entries) {
    const ref = db.doc(e.path), snap = await ref.get()
    if (!snap.exists) continue
    const d = snap.data()!
    if (e.kind === 'photo') {
      if (d.backfilled !== true || d.storagePath) { out.skippedChanged++; continue }
      if (opts.apply) await ref.delete(); out.removed++
    } else { if (opts.apply) await ref.update({ photosMigratedAt: FieldValue.delete() }); out.removed++ }
  }
  return out
}

// ── binary migration: PLAN only (no network, no Storage) ──
export interface BinaryManifestEntry { kind: 'photo' | 'winner'; eventId: string; photoId?: string; role?: 'groom' | 'bride'; legacyBucket: 'wedding-photos'; legacyPath: string; targetPath: string; contentType: string | null }
/** Deterministic target paths for every file that would be copied; the copy executor (separate, explicit) consumes this manifest. */
export async function buildBinaryManifest(input: PhotoSnapshot, db: Firestore, opts: { legacyUserId?: string } = {}): Promise<{ entries: BinaryManifestEntry[]; unmapped: number; skipped: number }> {
  const sessionById = new Map(input.sessions.map((s) => [s.id, s]))
  const inScope = (sid: string) => !opts.legacyUserId || sessionById.get(sid)?.dj_id === opts.legacyUserId
  const ids = new Set<string>(input.photos.filter((p) => inScope(p.session_id)).map((p) => p.session_id)); for (const s of input.sessions) if (inScope(s.id)) ids.add(s.id)
  const { map } = await eventsBySession(db, Array.from(ids))
  const entries: BinaryManifestEntry[] = []; let unmapped = 0, skipped = 0
  for (const p of input.photos.filter((x) => inScope(x.session_id))) {
    const ev = map.get(p.session_id), ext = extOf(p.storage_path)
    if (!ev) { unmapped++; continue }
    if (!MIME[ext] || unsafe(p.storage_path)) { skipped++; continue }
    entries.push({ kind: 'photo', eventId: ev.id, photoId: p.id, legacyBucket: 'wedding-photos', legacyPath: p.storage_path, targetPath: `events/${ev.id}/photos/${p.id}/original.${ext === 'jpeg' ? 'jpeg' : ext}`, contentType: MIME[ext] })
  }
  for (const sid of ids) {
    const ev = map.get(sid); if (!ev) continue
    for (const w of winnerPaths(sessionById.get(sid)?.winner_announcement).filter((x) => !x.path.startsWith('events/'))) {
      const ext = extOf(w.path)
      if (!MIME[ext] || unsafe(w.path)) { skipped++; continue }
      const token = Buffer.from(`${ev.id}:${w.role}:${w.path}`).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 24).padEnd(12, 'x')
      entries.push({ kind: 'winner', eventId: ev.id, role: w.role, legacyBucket: 'wedding-photos', legacyPath: w.path, targetPath: `events/${ev.id}/winner/${w.role}-${token}.${ext}`, contentType: MIME[ext] })
    }
  }
  return { entries, unmapped, skipped }
}
