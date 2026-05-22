-- ═══════════════════════════════════════════════════════════════
--  Migration 005: Remix Workstation Foundation
--
--  Pivot from automatic mashup generator to AI-assisted remix
--  workstation. Adds persistent stems, arrangement JSON storage,
--  proprietary soundbank catalog, and per-user sample library.
-- ═══════════════════════════════════════════════════════════════

-- ── Stems: Demucs-separated audio persisted per project ───────
-- Previously ephemeral (work_dir only). The workstation needs
-- them addressable for the lifetime of the project so users can
-- drag them onto the timeline at any time.
CREATE TABLE IF NOT EXISTS stems (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_track_id UUID          REFERENCES uploaded_tracks(id) ON DELETE SET NULL,
  side            TEXT          NOT NULL CHECK (side IN ('a','b')),
  stem_name       TEXT          NOT NULL,  -- vocals|drums|bass|other|guitar|piano
  s3_key          TEXT          NOT NULL,  -- stems/{project_id}/{side}/{stem}.wav
  duration_sec    FLOAT,
  sample_rate     INTEGER,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, side, stem_name)
);

CREATE INDEX IF NOT EXISTS idx_stems_project ON stems(project_id);

-- ── Arrangements: timeline JSON owned by a project ────────────
-- One project may have multiple arrangement versions (AI seed,
-- user edits, manual re-seeds). The latest editable arrangement
-- is whichever has the highest version for a project_id.
CREATE TABLE IF NOT EXISTS arrangements (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version      INTEGER       NOT NULL DEFAULT 1,
  source       TEXT          NOT NULL DEFAULT 'user'
                             CHECK (source IN ('ai_seed','user','ai_assist')),
  doc          JSONB         NOT NULL,  -- conforms to arrangement_schema v1
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_arrangements_project ON arrangements(project_id, version DESC);

-- ── Soundbank samples: proprietary IOMIXO library ─────────────
-- Catalog rows are public-readable; audio files live in the
-- soundbank-samples Storage bucket. Stub schema — content to be
-- ingested later.
CREATE TABLE IF NOT EXISTS soundbank_samples (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT          NOT NULL,  -- afro_house|deep_house|edm|chill|fx
  name          TEXT          NOT NULL,
  s3_key        TEXT          NOT NULL,  -- soundbank/{category}/{slug}.wav
  duration_sec  FLOAT,
  bpm           FLOAT,
  musical_key   TEXT,
  tags          TEXT[]        DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soundbank_category ON soundbank_samples(category);
CREATE INDEX IF NOT EXISTS idx_soundbank_bpm      ON soundbank_samples(bpm);

-- ── User samples: per-user imported audio ─────────────────────
CREATE TABLE IF NOT EXISTS user_samples (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT          NOT NULL,
  s3_key        TEXT          NOT NULL,  -- user_samples/{user_id}/{slug}.wav
  duration_sec  FLOAT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_samples_user ON user_samples(user_id);
