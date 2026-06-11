-- Migration: Add avatar_url column to dj_profiles
-- Purpose: The DJ profile (display name, bio, social links, slug) supports an
--          avatar photo. The backend (djProfile PATCH + PUT /avatar) and the
--          frontend profile page both read/write dj_profiles.avatar_url, but the
--          column was never created (missing from migration 008_live_hub.sql).
--          Without it, saving the profile or uploading a photo fails with
--          "Could not find the 'avatar_url' column of 'dj_profiles'".

ALTER TABLE dj_profiles
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

COMMENT ON COLUMN dj_profiles.avatar_url IS 'Public URL of the DJ profile avatar (Supabase Storage).';

-- Reload PostgREST schema cache so the new column is immediately visible.
NOTIFY pgrst, 'reload schema';
