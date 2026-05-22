-- ─────────────────────────────────────────────────────────────────────────────
-- 009_wedding_edition.sql
-- IOMIXO Live Hub → Wedding Edition.
-- - Renames legacy `club` plan → `wedding` (keeps `studio` alias path).
-- - Extends live_sessions with session_type + wedding fields.
-- - Adds: live_dedications, live_polls, live_poll_votes,
--         live_game_rounds, live_photos.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Plan rename: club → wedding ──────────────────────────────────────────────
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
UPDATE users SET plan = 'wedding' WHERE plan IN ('club', 'studio');
ALTER TABLE users
  ADD CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro', 'wedding'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
UPDATE subscriptions SET plan = 'wedding' WHERE plan IN ('club', 'studio');
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('free', 'pro', 'wedding'));

-- ── live_sessions: extend for Wedding Edition ────────────────────────────────
ALTER TABLE live_sessions
  ADD COLUMN IF NOT EXISTS session_type         TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS couple_names         TEXT,
  ADD COLUMN IF NOT EXISTS wedding_date         DATE,
  ADD COLUMN IF NOT EXISTS venue_name           TEXT,
  ADD COLUMN IF NOT EXISTS screen_mode_enabled  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_session_type_check;
ALTER TABLE live_sessions
  ADD CONSTRAINT live_sessions_session_type_check
  CHECK (session_type IN ('standard', 'wedding'));

CREATE INDEX IF NOT EXISTS idx_live_sessions_type ON live_sessions(session_type);

-- ── live_dedications: messages to the couple ─────────────────────────────────
CREATE TABLE IF NOT EXISTS live_dedications (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  guest_name  TEXT,
  message     TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_dedications_session
  ON live_dedications(session_id, status, created_at DESC);

-- ── live_polls: live audience polls ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_polls (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  question    TEXT         NOT NULL,
  options     JSONB        NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_polls_session
  ON live_polls(session_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS live_poll_votes (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id       UUID         NOT NULL REFERENCES live_polls(id) ON DELETE CASCADE,
  option_index  INT          NOT NULL,
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (poll_id, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_live_poll_votes_poll
  ON live_poll_votes(poll_id, option_index);

-- ── live_game_rounds: Wedding Roulette + future games ────────────────────────
CREATE TABLE IF NOT EXISTS live_game_rounds (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  game_type   TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'idle'
                           CHECK (status IN ('idle', 'running', 'completed')),
  config      JSONB,
  result      JSONB,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_game_rounds_session
  ON live_game_rounds(session_id, game_type, created_at DESC);

-- ── live_photos: guest photo album (Wedding) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS live_photos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  guest_name    TEXT,
  storage_path  TEXT         NOT NULL,
  caption       TEXT,
  status        TEXT         NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_photos_session
  ON live_photos(session_id, status, created_at DESC);

-- ── updated_at triggers ──────────────────────────────────────────────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'live_dedications','live_polls','live_game_rounds','live_photos'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I;
       CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE: Supabase Storage bucket required (create from dashboard or CLI):
--   Bucket name : wedding-photos
--   Public      : false (private; signed URLs delivered by API)
--   File limit  : 8 MB
--   MIME types  : image/jpeg, image/png, image/webp
-- ─────────────────────────────────────────────────────────────────────────────
