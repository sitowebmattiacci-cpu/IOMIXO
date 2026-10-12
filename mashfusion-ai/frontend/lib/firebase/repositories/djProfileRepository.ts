import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp,
  type Firestore, type DocumentData,
} from 'firebase/firestore'
import type { DjProfileDoc, DjProfilePatch } from '../models'

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)

function fromDoc(d: DocumentData): DjProfileDoc {
  return {
    displayName:   d.displayName   ?? null,
    bio:           d.bio           ?? null,
    avatarUrl:     d.avatarUrl     ?? null,
    avatarPath:    d.avatarPath    ?? null,
    instagramUrl:  d.instagramUrl  ?? null,
    tiktokUrl:     d.tiktokUrl     ?? null,
    spotifyUrl:    d.spotifyUrl    ?? null,
    soundcloudUrl: d.soundcloudUrl ?? null,
    websiteUrl:    d.websiteUrl    ?? null,
    publicSlug:    d.publicSlug    ?? null,
    createdAt:     toDate(d.createdAt),
    updatedAt:     toDate(d.updatedAt),
  }
}

export async function getDjProfile(db: Firestore, uid: string): Promise<DjProfileDoc | null> {
  const snap = await getDoc(doc(db, 'djProfiles', uid))
  return snap.exists() ? fromDoc(snap.data()) : null
}

/** Create-or-update the editable fields. publicSlug and the avatar fields are not writable from the client. */
export async function saveDjProfile(db: Firestore, uid: string, patch: DjProfilePatch): Promise<void> {
  const ref = doc(db, 'djProfiles', uid)
  const exists = (await getDoc(ref)).exists()
  if (exists) await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() })
  else await setDoc(ref, { ...patch, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
}
