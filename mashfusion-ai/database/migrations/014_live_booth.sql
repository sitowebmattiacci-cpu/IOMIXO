-- ─────────────────────────────────────────────────────────────────────────────
-- 014_live_booth.sql
-- Live Booth: premium wedding photo experience
-- Extends live_photos with featured flag and source tracking.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── live_photos: add is_featured and source ──────────────────────────────────
ALTER TABLE live_photos
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source      TEXT    NOT NULL DEFAULT 'guest_upload'
                                       CHECK (source IN ('guest_upload', 'live_booth'));

CREATE INDEX IF NOT EXISTS idx_live_photos_featured
  ON live_photos(session_id, is_featured, created_at DESC)
  WHERE is_featured = TRUE;

COMMIT;
