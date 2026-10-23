import { FieldValue, Timestamp, type Firestore, type DocumentData, type DocumentReference } from 'firebase-admin/firestore'
import { brandFromEvent } from '../owner/brand'
import { trialExpiresAt } from '../photos/trialQuota'
import { albumExpiresAt, trialPurgeAt } from '../photos/albumLifecycle'
import { countPrefix, deletePrefix } from '../photos/storage'

/**
 * Retention purge of MIOLOVE albums (scheduled once a day, see index.ts → purgeExpiredMioloveAlbums).
 *
 * WHEN an album's content must go (decided here from the authoritative fields, `purgeAfter` is only the index that finds candidates):
 *   - 'activated' and now >= expiresAt                 (activatedAt + 365 days)
 *   - 'trial' (never paid) and now >= trialExpiresAt + 30 days
 * It NEVER touches an IOMIXO / DJ event: the brand and the MIOLOVE accessMode are re-checked on the document itself before anything is deleted.
 *
 * WHAT happens, in this order (so a crash can only leave work to repeat, never a half-hidden album):
 *   1. claim   transaction: re-check "due" on the live doc, stamp purge.state='running' + a lease, close the album (status 'ended'). A payment can no longer activate it.
 *   2. Storage delete EVERYTHING under events/{id}/ (originals, optimized, thumbs, ZIP exports, winner photos, temp files); throws on failure; verified empty.
 *   3. Firestore recursively delete every subcollection (media docs, exports, requests, dedications, guests...). The event doc itself stays as a tombstone.
 *   4. slug     eventSlugs/{slug} is removed: the public link and QR stop resolving.
 *   5. tombstone replace the event doc with the administrative minimum (owner, brand, dates, activation proof, purge record), hidden from the owner's list (deletedAt).
 * Kept on purpose: users/{uid}/payments/*, mioloveStripeEvents/*, trialAlbums/{uid} (payments, audit, accounting, one-trial-per-account) and the tombstone itself.
 * Idempotent: a purged album is skipped; a failed step leaves purge.state 'failed' / an expiring lease and the next run resumes (purgeAfter is still set).
 */
export const PURGE_LEASE_MS = 15 * 60_000
export type PurgeReason = 'album_expired' | 'trial_lapsed'
export type PurgeOutcome = 'purged' | 'skipped' | 'busy' | 'failed'

/** Which reason makes this album's content due at `now`, or null (not due / not a MIOLOVE lifecycle album / already purged). Pure. */
export function purgeReasonOf(ev: DocumentData, now: Date): PurgeReason | null {
  if (ev.purgedAt || ev.accessMode === 'purged') return null
  if (brandFromEvent(ev) !== 'miolove') return null                              // 'owner' (undecided legacy) and 'iomixo' are never purged
  if (ev.accessMode === 'activated') {
    const end = albumExpiresAt(ev)
    return end && end.getTime() <= now.getTime() ? 'album_expired' : null
  }
  if (ev.accessMode === 'trial') {
    const end = trialExpiresAt(ev)
    return end && trialPurgeAt(end).getTime() <= now.getTime() ? 'trial_lapsed' : null
  }
  return null                                                                     // pending / legacy: nothing was ever paid or kept for them
}

const errCode = (e: unknown) => String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? 'error').slice(0, 120)

/** What survives of the album: the administrative minimum, no personal content. */
function tombstoneOf(ev: DocumentData, reason: PurgeReason, now: Date, counts: Record<string, number>): Record<string, unknown> {
  const keep = (k: string) => (ev[k] !== undefined ? { [k]: ev[k] } : {})
  return {
    ...keep('ownerUid'), ...keep('brand'), ...keep('type'), ...keep('createdAt'), ...keep('legacySupabaseId'),
    ...keep('activatedAt'), ...keep('activation'), ...keep('trialStartsAt'),
    accessMode: 'purged', status: 'ended',
    purgedAt: Timestamp.fromDate(now), deletedAt: Timestamp.fromDate(now), deletedBy: 'system:purge',     // hidden from the owner's list, unreadable by get
    purge: { state: 'done', reason, at: Timestamp.fromDate(now), expiresAt: ev.expiresAt ?? null, trialExpiresAt: ev.trialExpiresAt ?? null, removed: counts },
    updatedAt: FieldValue.serverTimestamp(),
  }
}

/** The two Storage operations, injectable so a test can make a delete fail half way (the job must then resume). */
export interface PurgeStorage { deletePrefix(prefix: string): Promise<number>; countPrefix(prefix: string): Promise<number> }
const realStorage: PurgeStorage = { deletePrefix, countPrefix }

export async function purgeAlbum(db: Firestore, ref: DocumentReference, now: Date, storage: PurgeStorage = realStorage): Promise<PurgeOutcome> {
  // 1. claim
  let ev: DocumentData | null = null, reason: PurgeReason | null = null
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return 'skipped' as const
    const d = snap.data()!
    reason = purgeReasonOf(d, now)
    if (!reason) return 'skipped' as const                                         // purged already, activated meanwhile, or never due
    const lease = d.purge?.lockedUntil instanceof Timestamp ? d.purge.lockedUntil.toMillis() : 0
    if (d.purge?.state === 'running' && lease > now.getTime()) return 'busy' as const
    ev = d
    tx.update(ref, {
      status: 'ended', updatedAt: FieldValue.serverTimestamp(),
      purge: { state: 'running', reason, startedAt: d.purge?.startedAt ?? Timestamp.fromDate(now), lockedUntil: Timestamp.fromMillis(now.getTime() + PURGE_LEASE_MS), attempts: (d.purge?.attempts ?? 0) + 1 },
    })
    return 'claimed' as const
  })
  if (claim !== 'claimed') return claim
  const album = ev!, why = reason!

  try {
    const counts: Record<string, number> = {}
    // 2. Storage
    counts.objects = await storage.deletePrefix(`events/${ref.id}/`)
    if ((await storage.countPrefix(`events/${ref.id}/`)) !== 0) throw new Error('storage_not_empty')
    // 3. Firestore: every subcollection (media docs included)
    for (const col of await ref.listCollections()) {
      counts[col.id] = (await col.count().get()).data().count
      await db.recursiveDelete(col)
    }
    // 4. public link
    if (typeof album.slug === 'string' && album.slug) {
      const slugRef = db.collection('eventSlugs').doc(album.slug), s = await slugRef.get()
      if (s.exists && s.data()!.eventId === ref.id) await slugRef.delete()
    }
    // 5. tombstone (full replace: every personal / content field goes, purgeAfter with it so the scheduler never sees it again)
    await ref.set(tombstoneOf(album, why, now, counts))
    return 'purged'
  } catch (e) {
    console.error('[purge] failed', ref.id, errCode(e))
    await ref.update({ 'purge.state': 'failed', 'purge.error': errCode(e), 'purge.lockedUntil': FieldValue.delete(), 'purge.failedAt': Timestamp.fromDate(now) }).catch(() => {})
    return 'failed'
  }
}

export interface PurgeSummary { scanned: number; purged: number; skipped: number; busy: number; failed: number }

/** One run of the daily job: pages through every album whose purgeAfter has passed. Resumable and idempotent. */
export async function purgeExpiredAlbums(db: Firestore, now: Date = new Date(), opts: { pageSize?: number; maxAlbums?: number; storage?: PurgeStorage } = {}): Promise<PurgeSummary> {
  const pageSize = opts.pageSize ?? 25, maxAlbums = opts.maxAlbums ?? 200
  const sum: PurgeSummary = { scanned: 0, purged: 0, skipped: 0, busy: 0, failed: 0 }
  const seen = new Set<string>()
  // A page may hold albums that are "not due" after the exact re-check (or that failed): they stay in the index, so the cursor moves past them.
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null
  while (sum.scanned < maxAlbums) {
    let q = db.collection('events').where('purgeAfter', '<=', Timestamp.fromDate(now)).orderBy('purgeAfter')
    if (cursor) q = q.startAfter(cursor)
    const page = await q.limit(pageSize).get()
    if (page.empty) break
    for (const d of page.docs) {
      if (seen.has(d.id)) continue
      seen.add(d.id); sum.scanned++
      const r = await purgeAlbum(db, d.ref, now, opts.storage)
      sum[r === 'purged' ? 'purged' : r === 'skipped' ? 'skipped' : r === 'busy' ? 'busy' : 'failed']++
    }
    cursor = page.docs[page.docs.length - 1]
    if (page.size < pageSize) break
  }
  return sum
}
