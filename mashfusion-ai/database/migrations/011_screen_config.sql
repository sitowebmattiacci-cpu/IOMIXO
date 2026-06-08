-- NOTE: This file shares the `011_` prefix with `011_wedding_pass_24h.sql`.
-- The duplicate numbering is INTENTIONAL — it reflects the historical
-- order in which the two migrations were authored. Both files have
-- already been APPLIED in production. Do NOT rename either file:
-- renumbering would break the migration tracker and re-trigger them.
--
-- Migration: Add screen_config column to live_sessions
-- Purpose: Allow DJs to control which sections appear on the live screen

ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS screen_config JSONB DEFAULT NULL;

COMMENT ON COLUMN live_sessions.screen_config IS 'Controls which sections are visible on the live screen (photos, dedications, roulette, shoe_game, polls)';
