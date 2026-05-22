-- ═══════════════════════════════════════════════════════════════
--  Migration 006: Soundbank ingestion metadata
--
--  Phase 7 adds the columns the admin ingestion form writes:
--  style, energy. `tags` already exists from migration 005.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE soundbank_samples
  ADD COLUMN IF NOT EXISTS style  TEXT,
  ADD COLUMN IF NOT EXISTS energy TEXT;

CREATE INDEX IF NOT EXISTS idx_soundbank_style ON soundbank_samples(style);
