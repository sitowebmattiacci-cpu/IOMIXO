import { randomUUID } from 'node:crypto'
import { getStorage } from 'firebase-admin/storage'

/**
 * Admin-side Storage helpers (server only). Bucket = `${project}.firebasestorage.app` (the project default; demo-iomixo in the emulator, where the
 * client config uses the same name). Every helper is best effort where a failure must not roll back a Firestore decision, and says so.
 */
export const bucketName = () => process.env.STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT}.firebasestorage.app`
const bucket = () => getStorage().bucket(bucketName())

export interface ObjectInfo { size: number; contentType: string }

/** null when the object does not exist. */
export async function objectInfo(path: string): Promise<ObjectInfo | null> {
  const file = bucket().file(path)
  const [exists] = await file.exists()
  if (!exists) return null
  const [m] = await file.getMetadata()
  return { size: Number(m.size ?? 0), contentType: String(m.contentType ?? '') }
}

/** Deletes objects, ignoring "not found" and any other error (logged without paths' content). Returns how many were really removed. */
export async function deleteObjects(paths: string[]): Promise<number> {
  let n = 0
  for (const p of paths) {
    try { await bucket().file(p).delete({ ignoreNotFound: true }); n++ } catch (e) { console.error('[storage] delete failed', (e as Error).message) }
  }
  return n
}

/**
 * Invalidates every download URL already handed out for an object (Firebase download URLs carry a long-lived token): called when a photo
 * stops being approved, so a rejected photo cannot keep being served from a cached link. Best effort.
 */
export async function rotateDownloadToken(path: string): Promise<boolean> {
  try { await bucket().file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: randomUUID() } }); return true }
  catch (e) { console.error('[storage] token rotation failed', (e as Error).message); return false }
}

export type TokenRevocation = 'revoked' | 'gone' | 'failed'

/**
 * Like rotateDownloadToken but says WHAT happened, for a revocation that must not claim success it did not achieve: 'revoked' (a fresh token replaced the old
 * ones), 'gone' (the object no longer exists, so no link can serve it: nothing left to revoke) or 'failed' (anything else: the old link may still work).
 */
export async function revokeDownloadToken(path: string): Promise<TokenRevocation> {
  try { await bucket().file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: randomUUID() } }); return 'revoked' }
  catch (e) {
    if ((e as { code?: number }).code === 404) return 'gone'
    console.error('[storage] token revocation failed', (e as Error).message)
    return 'failed'
  }
}

// ── Export support (album ZIP) ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Streams, never buffers: an album may weigh many GB. */
export const readStream = (path: string) => bucket().file(path).createReadStream()
export const objectExists = async (path: string): Promise<boolean> => (await bucket().file(path).exists())[0]
export const writeStream = (path: string, contentType: string, contentDisposition: string) =>
  bucket().file(path).createWriteStream({ resumable: true, contentType, metadata: { contentType, contentDisposition, cacheControl: 'private,max-age=0' } })

/**
 * Gives an object a FRESH download token (the previous ones stop working) and returns the URL that carries it. Used for the export archive only:
 * the token is the capability, it is handed to the event owner alone, and the archive is deleted when its export expires.
 */
export async function issueDownloadUrl(path: string): Promise<string> {
  const token = randomUUID()
  await bucket().file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } })
  const emulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST
  const base = emulator ? (/^https?:\/\//.test(emulator) ? emulator : `http://${emulator}`) : 'https://firebasestorage.googleapis.com'
  return `${base}/v0/b/${bucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

/**
 * Deletes EVERY object under a prefix (an album's whole folder: originals, optimized copies, thumbnails, export archives, winner photos, temp files) and
 * returns how many were removed. Unlike deleteObjects it THROWS on a failure: the purge job must not mark an album as purged while files are left.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  const [files] = await bucket().getFiles({ prefix })
  for (const f of files) await f.delete({ ignoreNotFound: true })
  return files.length
}

/** How many objects remain under a prefix (used by the purge to verify its own work). */
export async function countPrefix(prefix: string): Promise<number> {
  const [files] = await bucket().getFiles({ prefix, maxResults: 1 })
  return files.length
}
