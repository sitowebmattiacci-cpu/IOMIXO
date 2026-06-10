-- Migration: Add guest_config column to live_sessions
-- Purpose: Let DJs control which interactive functions guests can see/use
--          from the QR Code (public live page). This is INDEPENDENT from
--          screen_config (which controls the TV/screen view). Premium gating
--          (Advance plan or active Event Pass 24H) still applies on top.

ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS guest_config JSONB DEFAULT NULL;

COMMENT ON COLUMN live_sessions.guest_config IS 'Controls which interactive functions guests see on the public live page (requests, photos, dedications, shoe_game, polls, live_booth, music_battle, roulette). Independent from screen_config.';
