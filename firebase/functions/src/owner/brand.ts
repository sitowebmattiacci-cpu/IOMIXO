import type { DocumentData, Firestore } from 'firebase-admin/firestore'

/**
 * Which product an event belongs to. One Firebase identity may own events of BOTH products, so the owner's account type can no longer say it:
 * the event carries its own `brand`, written by createEvent. Events created before the field keep their old classification:
 * only Wedding events can be MIOLOVE albums, and those are recognised by accessMode ('trial' / 'activated', server-written) or, last, by
 * a couple-typed owner. Everything else is IOMIXO.
 */
export type EventBrand = 'iomixo' | 'miolove'

export const parseBrand = (raw: unknown): EventBrand | null => (raw === 'iomixo' || raw === 'miolove' ? raw : null)

/** Pure part: `needsOwner` = the event data alone is not conclusive and the owner's legacy account type decides. */
export function brandFromEvent(ev: DocumentData): EventBrand | 'owner' {
  const explicit = parseBrand(ev.brand)
  if (explicit) return explicit
  if (ev.type !== 'wedding') return 'iomixo'
  if (ev.accessMode === 'trial' || ev.accessMode === 'activated') return 'miolove'
  return 'owner'
}

export async function eventBrandOf(db: Firestore, ev: DocumentData): Promise<EventBrand> {
  const b = brandFromEvent(ev)
  if (b !== 'owner') return b
  if (typeof ev.ownerUid !== 'string' || !ev.ownerUid) return 'iomixo'
  const owner = await db.collection('users').doc(ev.ownerUid).get()
  return owner.exists && owner.data()!.accountType === 'couple' ? 'miolove' : 'iomixo'    // no field = legacy account = DJ
}
