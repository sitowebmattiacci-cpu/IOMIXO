-- ─────────────────────────────────────────────────────────────────────────────
-- 008_live_hub.sql
-- IOMIXO Live Hub: DJ sessions, public song requests, DJ profile, events.
-- Renames legacy `studio` plan → `club`.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Plan rename: studio → club ───────────────────────────────────────────────
-- Drop old CHECK, migrate values, re-add CHECK with new tier set.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
UPDATE users SET plan = 'club' WHERE plan = 'studio';
ALTER TABLE users
  ADD CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro', 'club'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
UPDATE subscriptions SET plan = 'club' WHERE plan = 'studio';
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('free', 'pro', 'club'));

-- ── live_sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_sessions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  dj_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name   TEXT         NOT NULL,
  dj_name      TEXT,
  description  TEXT,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  public_slug  TEXT         UNIQUE NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_dj_id    ON live_sessions(dj_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_active   ON live_sessions(dj_id, is_active);

-- ── live_requests ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS live_requests (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID         NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  track_title  TEXT         NOT NULL,
  artist       TEXT,
  message      TEXT,
  status       TEXT         NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash      TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_requests_session  ON live_requests(session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_requests_iphash   ON live_requests(session_id, ip_hash, created_at DESC);

-- ── dj_profiles ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dj_profiles (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name    TEXT,
  bio             TEXT,
  instagram_url   TEXT,
  tiktok_url      TEXT,
  spotify_url     TEXT,
  soundcloud_url  TEXT,
  website_url     TEXT,
  public_slug     TEXT         UNIQUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dj_profiles_user_id    ON dj_profiles(user_id);

-- ── dj_events ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dj_events (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT         NOT NULL,
  event_date  DATE,
  venue_name  TEXT,
  city        TEXT,
  ticket_url  TEXT,
  is_public   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dj_events_user_id      ON dj_events(user_id, event_date);

-- ── updated_at triggers (reuse existing set_updated_at function) ─────────────
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['live_sessions','live_requests','dj_profiles']
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
