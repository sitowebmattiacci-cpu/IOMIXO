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
