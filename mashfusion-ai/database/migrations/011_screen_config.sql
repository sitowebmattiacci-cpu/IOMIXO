-- Migration: Add screen_config column to live_sessions
-- Purpose: Allow DJs to control which sections appear on the live screen

ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS screen_config JSONB DEFAULT NULL;

COMMENT ON COLUMN live_sessions.screen_config IS 'Controls which sections are visible on the live screen (photos, dedications, roulette, shoe_game, polls)';
