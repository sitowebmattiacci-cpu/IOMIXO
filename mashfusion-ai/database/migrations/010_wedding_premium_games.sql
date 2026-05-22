-- ══════════════════════════════════════════════════════════════
-- Migration 010: Wedding Premium Games
-- Adds 5 new interactive games for Wedding Edition
-- ══════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- 1. FUTURE MESSAGES
-- Guests write messages to be delivered to the couple in the future
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_future_messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  guest_name      TEXT,
  message         TEXT         NOT NULL,
  delivery_year   TEXT,
  is_selected     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_future_messages_session
  ON live_future_messages(session_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────
-- 2. GUESS THE COUPLE (Trivia)
-- Public votes on couple trivia questions
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_couple_trivia (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  question        TEXT         NOT NULL,
  option_a        TEXT         NOT NULL,
  option_b        TEXT         NOT NULL,
  couple_answer   TEXT         CHECK (couple_answer IN ('a', 'b')),
  is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS live_couple_trivia_votes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  trivia_id       UUID         NOT NULL REFERENCES live_couple_trivia(id) ON DELETE CASCADE,
  vote            TEXT         NOT NULL CHECK (vote IN ('a', 'b')),
  ip_hash         TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(trivia_id, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_live_couple_trivia_session
  ON live_couple_trivia(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_couple_trivia_votes_trivia
  ON live_couple_trivia_votes(trivia_id);

-- ────────────────────────────────────────────────────────────────
-- 3. SONG OF THE COUPLE
-- Guests suggest songs, DJ picks winner
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_song_suggestions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  guest_name      TEXT,
  song_title      TEXT         NOT NULL,
  artist          TEXT,
  status          TEXT         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'approved', 'winner', 'rejected')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_song_suggestions_session
  ON live_song_suggestions(session_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────
-- 4. BEST PHOTO CONTEST
-- Voting on approved photos (extends existing live_photos)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_photo_votes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id        UUID         NOT NULL REFERENCES live_photos(id) ON DELETE CASCADE,
  ip_hash         TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(photo_id, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_live_photo_votes_photo
  ON live_photo_votes(photo_id);

-- ────────────────────────────────────────────────────────────────
-- 5. SECRET MESSAGES
-- Anonymous messages read by DJ
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_secret_messages (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  message         TEXT         NOT NULL,
  is_read         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_secret_messages_session
  ON live_secret_messages(session_id, created_at DESC);
