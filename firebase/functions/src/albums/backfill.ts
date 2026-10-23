import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { brandFromEvent } from '../owner/brand'
import { trialExpiresAt } from '../photos/trialQuota'
import { albumActivatedAt, albumExpiresAt, albumExpiryFrom, albumPurgeAfter, trialPurgeAt } from '../photos/albumLifecycle'

/**
 * One-shot, SAFE backfill of the retention fields on MIOLOVE albums that existed before the multi-album lifecycle:
 *   - 'activated' with activatedAt and NO expiresAt  →  expiresAt = activatedAt + 365 days (never "now"), purgeAfter = expiresAt
 *   - 'trial' with trialExpiresAt and NO purgeAfter  →  purgeAfter = trialExpiresAt + 30 days
 * Only MIOLOVE albums with an explicit accessMode are looked at (IOMIXO / DJ events have none, so they can never be touched). Nothing is overwritten that already has a value,
 * an 'activated' album without activatedAt is reported and left alone (it has no date to count from). `apply: false` (default) only reports.
 */
export interface BackfillReport { scanned: number; activatedFixed: number; trialFixed: number; activatedWithoutDate: string[]; alreadyOk: number; applied: boolean; changes: Array<{ id: string; set: Record<string, string> }> }

export async function backfillAlbumExpiry(db: Firestore, opts: { apply?: boolean } = {}): Promise<BackfillReport> {
  const apply = opts.apply === true
  const rep: BackfillReport = { scanned: 0, activatedFixed: 0, trialFixed: 0, activatedWithoutDate: [], alreadyOk: 0, applied: apply, changes: [] }
  const snap = await db.collection('events').where('accessMode', 'in', ['activated', 'trial']).get()
  for (const d of snap.docs) {
    const e = d.data()
    if (brandFromEvent(e) !== 'miolove' || e.purgedAt) continue
    rep.scanned++
    const patch: Record<string, Timestamp> = {}
    if (e.accessMode === 'activated') {
      const at = albumActivatedAt(e)
      if (!at) { rep.activatedWithoutDate.push(d.id); continue }
      const end = albumExpiresAt(e) ?? albumExpiryFrom(at)
      if (!albumExpiresAt(e)) patch.expiresAt = Timestamp.fromDate(end)
      if (!albumPurgeAfter(e)) patch.purgeAfter = Timestamp.fromDate(end)
      if (Object.keys(patch).length) rep.activatedFixed++
    } else {
      const end = trialExpiresAt(e)
      if (end && !albumPurgeAfter(e)) { patch.purgeAfter = Timestamp.fromDate(trialPurgeAt(end)); rep.trialFixed++ }
    }
    if (!Object.keys(patch).length) { rep.alreadyOk++; continue }
    rep.changes.push({ id: d.id, set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v.toDate().toISOString()])) })
    if (apply) await d.ref.update(patch)
  }
  return rep
}
