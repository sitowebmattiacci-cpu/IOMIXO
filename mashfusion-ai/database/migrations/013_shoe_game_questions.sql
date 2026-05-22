-- Migration: Add shoe_game_questions column to live_sessions
-- Purpose: Allow DJs to customize shoe game questions

ALTER TABLE live_sessions
ADD COLUMN IF NOT EXISTS shoe_game_questions JSONB DEFAULT NULL;

COMMENT ON COLUMN live_sessions.shoe_game_questions IS 'Custom questions for the shoe game';
