import { firestore, isFirebaseAuthConfigured } from '../lib/firebaseAdmin'

/**
 * MIOLOVE "Galleria condivisa" (events/{id}.guestConfig.shared_gallery) for the LEGACY Supabase photo listings.
 *
 * Those two public routes (GET /api/live/public/:slug/photos and GET /api/live/:slug/photos) answer anyone who knows a slug with signed URLs of the
 * session's photos. For a session that now lives in Firestore as a MIOLOVE album the owner's switch must hold here too (firestore.rules / storage.rules
 * already enforce it for the Firebase path), so a guest cannot read around it through this older door.
 *
 * Only a MIOLOVE album with the switch not true is hidden. A slug with no Firestore event (a pure legacy session), a DJ / IOMIXO event and any other case
 * are answered exactly as before. If Firebase Admin is not configured the gate cannot know and does nothing (same as before); if it IS configured and the
 * lookup fails, the listing is hidden (closed) rather than risk leaking a MIOLOVE album.
 *
 * Classification mirrors firebase/functions/src/owner/brand.ts (explicit brand, else wedding + a server-written accessMode, else a couple-typed owner).
 */
export async function legacyPhotosHiddenFromGuests(slug: string): Promise<boolean> {
  if (!isFirebaseAuthConfigured()) return false
  try {
    const db = firestore()
    const s = await db.collection('eventSlugs').doc(slug).get()
    if (!s.exists) return false
    const ev = (await db.collection('events').doc(String(s.data()!.eventId)).get()).data()
    if (!ev) return false
    let miolove = ev.brand === 'miolove'
    if (ev.brand !== 'miolove' && ev.brand !== 'iomixo' && ev.type === 'wedding') {
      miolove = ['trial', 'pending', 'activated', 'purged'].includes(ev.accessMode)
      if (!miolove && typeof ev.ownerUid === 'string' && ev.ownerUid) {
        const owner = await db.collection('users').doc(ev.ownerUid).get()
        miolove = owner.exists && owner.data()!.accountType === 'couple'
      }
    }
    if (!miolove) return false
    const cfg = ev.guestConfig
    return !(cfg && typeof cfg === 'object' && (cfg as Record<string, unknown>).shared_gallery === true)
  } catch (e) {
    console.error('[sharedGalleryGate] lookup failed, hiding the legacy listing:', (e as Error).message)
    return true
  }
}
