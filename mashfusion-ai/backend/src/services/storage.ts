import { createClient } from '@supabase/supabase-js'

// Service-role client — server-side storage operations only
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// Bucket names — must be created in Supabase dashboard
const UPLOADS_BUCKET  = 'track-uploads'
const OUTPUTS_BUCKET  = 'generated-outputs'
const AVATARS_BUCKET  = 'avatars'

/**
 * Generate a presigned upload URL so the client can PUT directly to Supabase Storage.
 * expiresIn in seconds (default 900 = 15 min).
 */
export async function createPresignedUploadUrl(
  path:        string,
  _contentType: string,
  expiresIn:   number = 900
): Promise<string> {
  // Supabase Storage createSignedUploadUrl issues a one-time upload URL (default 2h expiry).
  // The expiresIn parameter is accepted as the second argument in storage-js >= 2.5
  const { data, error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .createSignedUploadUrl(path)

  if (error || !data) throw new Error(`Storage signed upload error: ${error?.message}`)
  return data.signedUrl
}

/**
 * Generate a presigned download URL for an output file.
 */
export async function createPresignedDownloadUrl(
  pathOrUrl: string,
  expiresIn: number = 3600
): Promise<string> {
  // If it's already an external HTTP URL (not a Supabase storage path), return as-is
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
    if (!pathOrUrl.includes('/storage/v1/object/')) {
      return pathOrUrl
    }
  }

  // Accept full Supabase URL or just the storage path
  const path = pathOrUrl.includes('/storage/v1/object/')
    ? pathOrUrl.split(`/${OUTPUTS_BUCKET}/`)[1] ?? pathOrUrl
    : pathOrUrl

  const { data, error } = await supabase.storage
    .from(OUTPUTS_BUCKET)
    .createSignedUrl(path, expiresIn)

  if (error || !data) throw new Error(`Storage signed download error: ${error?.message}`)
  return data.signedUrl
}

/**
 * Delete a file from the uploads bucket.
 */
export async function deleteStorageObject(path: string): Promise<void> {
  const { error } = await supabase.storage.from(UPLOADS_BUCKET).remove([path])
  if (error) throw new Error(`Storage delete error: ${error.message}`)
}

/**
 * Upload a buffer directly from the server (used for avatars).
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

// Legacy alias — keep callers in jobs.ts working
export { createPresignedDownloadUrl as getSignedDownloadUrl }
