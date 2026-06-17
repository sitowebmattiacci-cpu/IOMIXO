// Ensure the 'avatars' Storage bucket exists and is public on the target
// Supabase project. Run with the PRODUCTION credentials:
//
//   SUPABASE_URL=https://zrayvqvxadjgfpupwhky.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   node scripts/make-avatars-public.mjs
//
// A public bucket grants anonymous read access to objects, which is what the
// DJ profile avatar public URL needs (…/storage/v1/object/public/avatars/…).

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = 'avatars'

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.')
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const projectRef = url.replace(/^https?:\/\//, '').split('.')[0]
console.log(`Target project: ${projectRef}`)

const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET)

if (getErr && !/not found/i.test(getErr.message)) {
  console.error(`getBucket error: ${getErr.message}`)
  process.exit(1)
}

if (!existing) {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '5MB',
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  })
  if (error) {
    console.error(`createBucket error: ${error.message}`)
    process.exit(1)
  }
  console.log(`Created bucket '${BUCKET}' (public).`)
} else if (!existing.public) {
  const { error } = await supabase.storage.updateBucket(BUCKET, { public: true })
  if (error) {
    console.error(`updateBucket error: ${error.message}`)
    process.exit(1)
  }
  console.log(`Bucket '${BUCKET}' set to public.`)
} else {
  console.log(`Bucket '${BUCKET}' already public. Nothing to do.`)
}

console.log('Done.')
