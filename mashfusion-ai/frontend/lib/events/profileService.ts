import { httpsCallable } from 'firebase/functions'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseFunctions, getFirebaseStorage } from '../firebase/client'
import { waitForAuthReady } from '../firebase/auth'
import { dashboardOn } from './ownerService'
import { createUser, getUser, updateUserProfile } from '../firebase/repositories/userRepository'
import { getDjProfile, saveDjProfile } from '../firebase/repositories/djProfileRepository'
import { extensionOf } from './photoService'
import type { DjProfileDoc } from '../firebase/models'
import type { DjProfile } from '../api'
import type { User } from '@/types'
import { dashboardOps } from './dashboardService'

/**
 * Profile + avatar on Firestore / Storage (owner, no Render, no Supabase), behind NEXT_PUBLIC_FIRESTORE_DASHBOARD.
 *  - account name  → users/{uid}.displayName            (direct write, firestore.rules)
 *  - DJ profile    → djProfiles/{uid}                    (direct write, firestore.rules; publicSlug is server-only and kept as migrated)
 *  - avatars       → bytes straight to Storage `profiles/{uid}/avatar/{user|dj}-<token>.<ext>` (storage.rules), then the `commitAvatar`
 *                    callable verifies the object, publishes the URL and deletes the replaced file; `removeAvatar` clears + deletes.
 * Every method resolves to `null` when it does not apply (flag off / not a Firebase account) so lib/api.ts keeps the legacy route.
 */
export type AvatarKind = 'user' | 'dj'
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const MESSAGES: Record<string, string> = {
  invalid_payload: 'Dati non validi',
  account_required: 'Accedi con il tuo account',
  unauthenticated: 'Accedi con il tuo account',
  upload_missing: 'Caricamento non riuscito, riprova.',
  file_too_large: 'Immagine troppo grande (max 5 MB).',
  invalid_image: 'File non valido: usa JPEG, PNG o WEBP.',
  not_your_avatar: 'Operazione non consentita',
}

async function call<Out>(name: string, payload: object): Promise<Out> {
  try {
    return (await httpsCallable<object, Out>(getFirebaseFunctions(), name)(payload)).data
  } catch (e) {
    const err = e as { message?: string; details?: { reason?: string } }
    throw new Error((err.details?.reason && MESSAGES[err.details.reason]) || err.message || 'Operazione non riuscita')
  }
}

async function account() {
  if (!dashboardOn()) return null
  const user = await waitForAuthReady()
  return user && !user.isAnonymous ? user : null
}

/** URL-safe random token (≥ 16 chars, as storage.rules requires). */
const token = () => {
  const b = new Uint8Array(18); globalThis.crypto.getRandomValues(b)
  return btoa(Array.from(b, (c) => String.fromCharCode(c)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function uploadAvatar(uid: string, kind: AvatarKind, file: File): Promise<void> {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error('Solo immagini JPEG, PNG o WEBP')
  if (file.size > AVATAR_MAX_BYTES) throw new Error(MESSAGES.file_too_large)
  const path = `profiles/${uid}/avatar/${kind}-${token()}.${extensionOf(file) === 'jpeg' ? 'jpg' : extensionOf(file)}`
  try { await uploadBytes(storageRef(getFirebaseStorage(), path), file, { contentType: file.type }) }
  catch { throw new Error(MESSAGES.upload_missing) }
  await call('commitAvatar', { kind, path })
}

export const djToLegacy = (d: DjProfileDoc | null): DjProfile | null => d && {
  display_name: d.displayName ?? null, bio: d.bio ?? null,
  instagram_url: d.instagramUrl ?? null, tiktok_url: d.tiktokUrl ?? null, spotify_url: d.spotifyUrl ?? null,
  soundcloud_url: d.soundcloudUrl ?? null, website_url: d.websiteUrl ?? null,
  avatar_url: d.avatarUrl ?? null, public_slug: d.publicSlug ?? null,
}

const clean = (v: string | null | undefined, max: number) => { const t = (v ?? '').trim(); return t ? t.slice(0, max) : null }

export const profileOps = {
  /** Account: rename (users/{uid}.displayName). */
  async updateName(fullName: string): Promise<User | null> {
    const u = await account(); if (!u) return null
    const db = getFirebaseDb(), displayName = fullName.trim().slice(0, 80)
    if (await getUser(db, u.uid)) await updateUserProfile(db, u.uid, { displayName })
    else await createUser(db, { uid: u.uid, email: u.email ?? '', displayName })   // first write of a native account: FREE default, rules enforce it
    return (await dashboardOps.me())
  },
  async uploadUserAvatar(file: File): Promise<User | null> {
    const u = await account(); if (!u) return null
    await uploadAvatar(u.uid, 'user', file)
    return dashboardOps.me()
  },
  async removeUserAvatar(): Promise<User | null> {
    const u = await account(); if (!u) return null
    await call('removeAvatar', { kind: 'user' })
    return dashboardOps.me()
  },

  /** DJ profile in the legacy `DjProfile` shape. `{ data: null }` = signed in, nothing saved yet; `null` = not applicable. */
  async getDj(): Promise<{ data: DjProfile | null } | null> {
    const u = await account(); if (!u) return null
    return { data: djToLegacy(await getDjProfile(getFirebaseDb(), u.uid)) }
  },
  async updateDj(patch: Partial<DjProfile>): Promise<DjProfile | null> {
    const u = await account(); if (!u) return null
    const db = getFirebaseDb()
    await saveDjProfile(db, u.uid, {
      displayName: clean(patch.display_name, 80), bio: clean(patch.bio, 1000),
      instagramUrl: clean(patch.instagram_url, 300), tiktokUrl: clean(patch.tiktok_url, 300), spotifyUrl: clean(patch.spotify_url, 300),
      soundcloudUrl: clean(patch.soundcloud_url, 300), websiteUrl: clean(patch.website_url, 300),
    })
    return djToLegacy(await getDjProfile(db, u.uid))
  },
  async uploadDjAvatar(file: File): Promise<DjProfile | null> {
    const u = await account(); if (!u) return null
    await uploadAvatar(u.uid, 'dj', file)
    return djToLegacy(await getDjProfile(getFirebaseDb(), u.uid))
  },
  async removeDjAvatar(): Promise<DjProfile | null> {
    const u = await account(); if (!u) return null
    await call('removeAvatar', { kind: 'dj' })
    return djToLegacy(await getDjProfile(getFirebaseDb(), u.uid))
  },
}
