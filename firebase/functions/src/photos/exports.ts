import archiver from 'archiver'
import { FieldValue, Timestamp, type Firestore, type DocumentReference } from 'firebase-admin/firestore'
import { fail } from '../shared/guard'
import { idField, requireEventOwner, type CallerAuth } from '../owner/guard'
import { deleteObjects, issueDownloadUrl, objectExists, readStream, writeStream } from './storage'
import { archiveEntryName, originalPathOf } from './media'
import { isTrialAlbum } from './trialQuota'

/**
 * "Download everything": ONE archive with the ORIGINALS (photos and videos) of an album, built on the server and streamed, never held in memory.
 *
 *   requestAlbumExport (owner callable)   checks owner + plan, writes events/{e}/exports/{x} { status: 'queued' } and returns at once
 *   onAlbumExportCreated (Firestore trigger) streams every original through a store-only ZIP into events/{e}/exports/{x}/album.zip, updating
 *                                           `processed` as it goes, then flips the doc to `ready` (or `failed`)
 *   getAlbumExportUrl (owner callable)    hands the owner a fresh, unguessable download URL for a READY export
 *
 * The owner follows the export doc in realtime (firestore.rules: owner read only; no client write). The archive is private (storage.rules deny
 * the exports path to every client) and is deleted when it expires (24 h) or when the owner asks for a new export.
 */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000
/** An export that has not moved for this long is considered dead (function killed / timed out): a new request replaces it. */
export const EXPORT_STALE_MS = 20 * 60 * 1000
export type ExportStatus = 'queued' | 'preparing' | 'ready' | 'failed'
/** Which photo docs go in: everything the owner can see except rejected media and unfinished uploads. */
const EXPORT_STATUSES = ['approved', 'pending']

export interface ExportRefInput { eventId: string; exportId: string }
export interface RequestExportInput { eventId: string }
export const parseRequestExportInput = (data: unknown): RequestExportInput => {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { eventId: idField(d.eventId, 'eventId') }
}
export const parseExportRefInput = (data: unknown): ExportRefInput => {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  return { eventId: idField(d.eventId, 'eventId'), exportId: idField(d.exportId, 'exportId') }
}

const zipPathOf = (eventId: string, exportId: string) => `events/${eventId}/exports/${exportId}/album.zip`
const ms = (t: unknown): number => (t instanceof Timestamp ? t.toMillis() : 0)

/** Deletes expired / failed exports (archive first, then the doc). Best effort: a leftover is retried by the next request / the periodic purge. Returns how many remain. */
async function purgeExports(eventRef: DocumentReference, eventId: string, now: number): Promise<number> {
  const snap = await eventRef.collection('exports').get()
  let left = 0
  for (const d of snap.docs) {
    const x = d.data()
    const dead = x.status === 'failed' || (x.status === 'ready' && ms(x.expiresAt) <= now) || ((x.status === 'queued' || x.status === 'preparing') && now - ms(x.updatedAt) > EXPORT_STALE_MS)
    if (!dead) { left++; continue }
    await deleteObjects([zipPathOf(eventId, d.id)])
    await d.ref.delete().catch(() => {})
  }
  return left
}

/**
 * Periodic purge (scheduled function): an archive is a private download link, so it must really disappear when its 24 h are over, even if the owner
 * never asks for another export. Albums that ever exported carry `hasExports: true` (one equality filter, no collection-group index needed).
 */
export async function purgeExpiredExports(db: Firestore, now: number = Date.now(), batch = 200): Promise<{ events: number; cleared: number }> {
  const events = await db.collection('events').where('hasExports', '==', true).limit(batch).get()
  let cleared = 0
  for (const e of events.docs) {
    const left = await purgeExports(e.ref, e.id, now)
    if (left === 0) { await e.ref.update({ hasExports: false }).catch(() => {}); cleared++ }
  }
  return { events: events.size, cleared }
}

export async function requestAlbumExport(db: Firestore, request: CallerAuth, input: RequestExportInput, now: () => number = Date.now): Promise<{ exportId: string; status: ExportStatus; total: number }> {
  const owner = await requireEventOwner(db, request, input.eventId)
  // "Download everything" belongs to the paid album: a free trial still downloads the files it selects one by one.
  if (isTrialAlbum(owner.data)) throw fail('permission-denied', 'Download all is part of the full album', 'export_requires_album')
  const t = now()
  await purgeExports(owner.ref, input.eventId, t)

  // One export at a time: a second click while one is running follows the running one.
  const running = await owner.ref.collection('exports').where('status', 'in', ['queued', 'preparing']).get()
  const live = running.docs.find((d) => t - ms(d.data().updatedAt) <= EXPORT_STALE_MS)
  if (live) return { exportId: live.id, status: live.data().status, total: Number(live.data().total ?? 0) }

  const media = await owner.ref.collection('photos').where('status', 'in', EXPORT_STATUSES).get()
  const total = media.docs.filter((d) => originalPathOf(d.data())).length
  if (total === 0) throw fail('failed-precondition', 'The album has no media to download', 'export_empty')
  const ref = owner.ref.collection('exports').doc()
  await owner.ref.update({ hasExports: true })                                                // lets the periodic purge find this album
  await ref.create({
    ownerUid: owner.uid, status: 'queued' as ExportStatus, total, processed: 0, skipped: 0, bytes: null, zipPath: zipPathOf(input.eventId, ref.id), error: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(t + EXPORT_TTL_MS),
  })
  return { exportId: ref.id, status: 'queued', total }
}

/** The trigger body. Never throws: every outcome is written on the export doc. */
export async function runAlbumExport(db: Firestore, eventId: string, exportId: string): Promise<void> {
  const ref = db.collection('events').doc(eventId).collection('exports').doc(exportId)
  const snap = await ref.get()
  if (!snap.exists || snap.data()!.status !== 'queued') return                 // a retried trigger must not run the same export twice
  const zipPath = zipPathOf(eventId, exportId)
  try {
    await ref.update({ status: 'preparing', updatedAt: FieldValue.serverTimestamp() })
    const media = await db.collection('events').doc(eventId).collection('photos').where('status', 'in', EXPORT_STATUSES).get()          // no orderBy: it would need a composite index; sorted below
    const items = media.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => originalPathOf(p))
      .sort((a: any, b: any) => ms(a.createdAt) - ms(b.createdAt))

    const out = writeStream(zipPath, 'application/zip', 'attachment; filename="album.zip"')
    const archive = archiver('zip', { store: true })
    const finished = new Promise<void>((resolve, reject) => { out.on('finish', () => resolve()); out.on('error', reject); archive.on('error', reject) })
    archive.pipe(out)

    let processed = 0, skipped = 0, lastWrite = Date.now()
    for (let i = 0; i < items.length; i++) {
      const p = items[i], path = originalPathOf(p)
      if (!(await objectExists(path))) { skipped++; continue }                  // a doc whose file is gone (never finalized / removed by hand): nothing to pack
      await new Promise<void>((resolve, reject) => {
        const rs = readStream(path)
        rs.on('error', reject)
        archive.once('entry', () => resolve())                                  // one original at a time: memory stays flat whatever the album weighs
        archive.append(rs, { name: archiveEntryName(i + 1, p) })
      })
      processed++
      if (Date.now() - lastWrite > 1500) { lastWrite = Date.now(); await ref.update({ processed, skipped, updatedAt: FieldValue.serverTimestamp() }) }
    }
    await archive.finalize()
    await finished
    await ref.update({ status: 'ready', processed, skipped, total: processed, bytes: archive.pointer(), updatedAt: FieldValue.serverTimestamp() })
  } catch (e) {
    console.error('[export] failed', (e as Error).message)
    await deleteObjects([zipPath])
    await ref.update({ status: 'failed', error: 'export_failed', updatedAt: FieldValue.serverTimestamp() }).catch(() => {})
  }
}

export async function getAlbumExportUrl(db: Firestore, request: CallerAuth, input: ExportRefInput, now: () => number = Date.now): Promise<{ url: string; bytes: number | null; expiresAt: number }> {
  const owner = await requireEventOwner(db, request, input.eventId)
  const snap = await owner.ref.collection('exports').doc(input.exportId).get()
  if (!snap.exists || snap.data()!.ownerUid !== owner.uid) throw fail('not-found', 'Export not found', 'export_not_found')
  const x = snap.data()!
  if (x.status !== 'ready') throw fail('failed-precondition', 'The archive is not ready', 'export_not_ready')
  if (ms(x.expiresAt) <= now()) throw fail('failed-precondition', 'The archive has expired', 'export_expired')
  return { url: await issueDownloadUrl(String(x.zipPath)), bytes: typeof x.bytes === 'number' ? x.bytes : null, expiresAt: ms(x.expiresAt) }
}
