import { createClient } from '@supabase/supabase-js'

// Service-role client — server-side storage operations only
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Buckets used by IOMIXO Live Hub ────────────────────────────
// Must be created in the Supabase dashboard.
const AVATARS_BUCKET               = 'avatars'        // public — DJ profile photos
export const WEDDING_PHOTOS_BUCKET = 'wedding-photos' // private — Live Booth / event album

/**
 * Upload a buffer directly from the server (used for DJ avatars).
 */
export async function uploadAvatar(
  userId:      string,
  fileBuffer:  Buffer,
  contentType: string,
  ext:         string
): Promise<string> {
  const path = `${userId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from(AVATARS_BUCKET)
    .upload(path, fileBuffer, { contentType, upsert: true, cacheControl: '31536000' })

  if (error) throw new Error(`Avatar upload error: ${error.message}`)

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Delete an avatar by its storage path (extracted from URL).
 */
export async function deleteAvatar(avatarUrl: string): Promise<void> {
  const marker = `/${AVATARS_BUCKET}/`
  if (!avatarUrl.includes(marker)) return
  const path = avatarUrl.split(marker)[1]
  await supabase.storage.from(AVATARS_BUCKET).remove([path])
}

/** Presigned PUT URL for a guest photo upload (Live Booth / Wedding Edition). */
export async function createWeddingPhotoUploadUrl(sessionId: string, ext: string): Promise<{ path: string; url: string }> {
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext.toLowerCase()) ? ext.toLowerCase() : 'jpg'
  const path = `${sessionId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
  const { data, error } = await supabase.storage
    .from(WEDDING_PHOTOS_BUCKET)
    .createSignedUploadUrl(path)
  if (error || !data) throw new Error(`Wedding photo upload URL error: ${error?.message}`)
  return { path, url: data.signedUrl }
}

/** Signed download URL for a wedding photo (private bucket). */
export async function createWeddingPhotoSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(WEDDING_PHOTOS_BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error || !data) throw new Error(`Wedding photo signed url error: ${error?.message}`)
  return data.signedUrl
}

export async function deleteWeddingPhoto(path: string): Promise<void> {
  await supabase.storage.from(WEDDING_PHOTOS_BUCKET).remove([path])
}
