import { randomUUID } from 'node:crypto'
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { bucketName, deleteObjects } from '../photos/storage'

/**
 * Avatar commit / remove (owner only). The BYTES go browser → Storage under storage.rules (create-only, owner folder, ≤5 MB, jpeg/png/webp);
 * these callables are the only writers of the avatar fields (`avatarPath`, `avatarUrl`) of users/{uid} (kind `user`, settings) and
 * djProfiles/{uid} (kind `dj`, public profile). Firestore rules do NOT let a client write them, so a client cannot point the public page at an
 * arbitrary URL or at somebody else's file.
 *
 * Storage path:  profiles/{uid}/avatar/{user|dj}-<token>.{jpg|png|webp}   (random token, never reused: a replacement is a new object)
 *
 * commitAvatar: checks the uploaded object (owner prefix, kind, size, type, magic bytes), mints a download token, writes path + URL,
 * then removes the avatar it replaces (the previous `avatarPath` of the same document).
 * removeAvatar: clears the fields and removes that object.
 * No bucket listing: the functions identity has no storage.objects.list (least privilege). An upload that is never committed stays unreferenced and
 * unreadable by anyone but its owner; a rejected one (bad bytes / size) is deleted by commitAvatar itself.
 */
export type AvatarKind = 'user' | 'dj'
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const PATH = /^profiles\/([A-Za-z0-9]{1,128})\/avatar\/(user|dj)-[A-Za-z0-9_-]{16,64}\.(jpg|png|webp)$/
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

const fail = (code: FunctionsErrorCode, reason: string): never => { throw new HttpsError(code, reason, { reason }) }

export function parseCommitAvatarInput(d: unknown): { kind: AvatarKind; path: string } {
  const o = (d ?? {}) as Record<string, unknown>
  if (o.kind !== 'user' && o.kind !== 'dj') return fail('invalid-argument', 'invalid_payload')
  if (typeof o.path !== 'string' || o.path.length > 300 || !PATH.test(o.path)) return fail('invalid-argument', 'invalid_payload')
  return { kind: o.kind, path: o.path }
}
export function parseRemoveAvatarInput(d: unknown): { kind: AvatarKind } {
  const o = (d ?? {}) as Record<string, unknown>
  if (o.kind !== 'user' && o.kind !== 'dj') return fail('invalid-argument', 'invalid_payload')
  return { kind: o.kind }
}

/** Real image signature (the Storage rule only sees the client-declared content type). */
export function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const bucket = () => getStorage().bucket(bucketName())
const docRef = (db: Firestore, kind: AvatarKind, uid: string) => db.collection(kind === 'user' ? 'users' : 'djProfiles').doc(uid)
const prefix = (uid: string, kind: AvatarKind) => `profiles/${uid}/avatar/${kind}-`
/** The avatar object a document points to, only if it really is this owner's avatar of this kind (never trusts a stored path blindly). */
const ownPath = (v: unknown, uid: string, kind: AvatarKind): string | null => (typeof v === 'string' && PATH.test(v) && v.startsWith(prefix(uid, kind)) ? v : null)

/** Firebase download URL for an object carrying the given token (same shape getDownloadURL returns; the emulator host is honoured). */
export function downloadUrl(path: string, token: string): string {
  const emu = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  const base = emu ? `http://${emu}` : 'https://firebasestorage.googleapis.com'
  return `${base}/v0/b/${bucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

export async function commitAvatar(
  db: Firestore, req: { auth?: { uid: string; token: { firebase?: { sign_in_provider?: string }; email?: string } } }, input: { kind: AvatarKind; path: string },
): Promise<{ avatarUrl: string; avatarPath: string }> {
  const auth = req.auth
  if (!auth?.uid || auth.token.firebase?.sign_in_provider === 'anonymous') return fail('unauthenticated', 'account_required')
  const uid = auth.uid
  const m = PATH.exec(input.path)
  if (!m || m[1] !== uid || m[2] !== input.kind) return fail('permission-denied', 'not_your_avatar')

  const file = bucket().file(input.path)
  const [exists] = await file.exists()
  if (!exists) return fail('failed-precondition', 'upload_missing')
  const [meta] = await file.getMetadata()
  const size = Number(meta.size ?? 0)
  if (size <= 0 || size > AVATAR_MAX_BYTES) { await deleteObjects([input.path]); return fail('invalid-argument', 'file_too_large') }
  const [head] = await file.download({ start: 0, end: 11 })
  const real = sniffImage(head)
  const ext = m[3]
  if (!real || real !== MIME_BY_EXT[ext]) { await deleteObjects([input.path]); return fail('invalid-argument', 'invalid_image') }

  const token = randomUUID()
  await file.setMetadata({ contentType: real, cacheControl: 'public,max-age=31536000,immutable', metadata: { firebaseStorageDownloadTokens: token } })
  const avatarUrl = downloadUrl(input.path, token)

  const ref = docRef(db, input.kind, uid)
  let previous: string | null = null
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref)
    previous = ownPath(cur.data()?.avatarPath, uid, input.kind)
    if (cur.exists) {
      tx.update(ref, { avatarPath: input.path, avatarUrl, updatedAt: FieldValue.serverTimestamp() })
    } else if (input.kind === 'dj') {
      tx.create(ref, { avatarPath: input.path, avatarUrl, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    } else {
      // Same FREE default document the client would have created; never any paid plan.
      tx.create(ref, { uid, email: auth.token.email ?? '', plan: { tier: 'free', source: 'default' }, avatarPath: input.path, avatarUrl, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    }
  })

  // The replaced avatar. Best effort: the Firestore decision above is already final.
  if (previous && previous !== input.path) await deleteObjects([previous])
  return { avatarUrl, avatarPath: input.path }
}

export async function removeAvatar(
  db: Firestore, req: { auth?: { uid: string; token: { firebase?: { sign_in_provider?: string } } } }, input: { kind: AvatarKind },
): Promise<{ removed: number }> {
  const auth = req.auth
  if (!auth?.uid || auth.token.firebase?.sign_in_provider === 'anonymous') return fail('unauthenticated', 'account_required')
  const ref = docRef(db, input.kind, auth.uid)
  const cur = await ref.get()
  if (cur.exists) await ref.update({ avatarPath: FieldValue.delete(), avatarUrl: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
  const old = ownPath(cur.data()?.avatarPath, auth.uid, input.kind)
  return { removed: old ? await deleteObjects([old]) : 0 }
}
