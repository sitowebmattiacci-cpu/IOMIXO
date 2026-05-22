-- Migration: Add roulette_penitenze column to live_sessions
-- Purpose: Allow DJs to customize roulette penalties

ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS roulette_penitenze JSONB DEFAULT NULL;

COMMENT ON COLUMN live_sessions.roulette_penitenze IS 'Custom penalties for the wedding roulette game';
