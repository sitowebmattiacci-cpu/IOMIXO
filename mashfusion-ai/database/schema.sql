-- IOMIXO — PostgreSQL Schema
-- Compatible with Supabase (PostgreSQL 15+)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  email                           TEXT          UNIQUE NOT NULL,
  password_hash                   TEXT,         -- NULL for Supabase-auth managed users
  full_name                       TEXT,
  avatar_url                      TEXT,
  plan                            TEXT          NOT NULL DEFAULT 'free'
                                                CHECK (plan IN ('free', 'pro', 'studio')),
  credits_remaining               INTEGER       NOT NULL DEFAULT 1,
  credits_reset_at                TIMESTAMPTZ,
  stripe_customer_id              TEXT          UNIQUE,
  email_verified                  BOOLEAN       NOT NULL DEFAULT FALSE,
  email_verification_token        TEXT,
  email_verification_expires_at   TIMESTAMPTZ,
  password_reset_token            TEXT,
  password_reset_expires_at       TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Subscriptions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id   TEXT         UNIQUE NOT NULL,
  stripe_customer_id       TEXT         NOT NULL,
  plan                     TEXT         NOT NULL CHECK (plan IN ('free', 'pro', 'studio')),
  status                   TEXT         NOT NULL,   -- active, canceled, past_due, etc.
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN      NOT NULL DEFAULT FALSE,
  canceled_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Uploaded Tracks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploaded_tracks (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id          UUID,         -- set after project confirmed
  s3_key              TEXT          NOT NULL,
  original_filename   TEXT          NOT NULL,
  mime_type           TEXT          NOT NULL,
  s3_url              TEXT,
  file_size_bytes     BIGINT,
  duration_seconds    FLOAT,
  role                TEXT          CHECK (role IN ('track_a', 'track_b')),
  upload_status       TEXT          NOT NULL DEFAULT 'pending'
                                    CHECK (upload_status IN ('pending', 'uploading', 'ready', 'failed', 'deleted')),
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT          NOT NULL,
  track_a_id      UUID          REFERENCES uploaded_tracks(id) ON DELETE SET NULL,
  track_b_id      UUID          REFERENCES uploaded_tracks(id) ON DELETE SET NULL,
  remix_style     TEXT          DEFAULT 'none',
  output_quality  TEXT          DEFAULT 'standard',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Backfill foreign key from uploaded_tracks → projects
DO $$ BEGIN
  ALTER TABLE uploaded_tracks
    ADD CONSTRAINT fk_track_project
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Analysis Results
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_results (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id          UUID          UNIQUE NOT NULL REFERENCES uploaded_tracks(id) ON DELETE CASCADE,
  bpm               FLOAT,
  bpm_confidence    FLOAT,
  musical_key       TEXT,
  key_confidence    FLOAT,
  time_signature    TEXT          DEFAULT '4/4',
  sections          JSONB         DEFAULT '[]',
  beat_timestamps   JSONB         DEFAULT '[]',
  energy_map        JSONB         DEFAULT '[]',
  analyzed_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Render Jobs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS render_jobs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id               UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                TEXT          NOT NULL DEFAULT 'queued'
                                      CHECK (status IN (
                                        'queued', 'processing', 'complete', 'failed', 'canceled'
                                      )),
  progress              INTEGER       NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  current_stage         TEXT,
  stage_progress        JSONB         DEFAULT '{}',
  remix_style           TEXT          NOT NULL DEFAULT 'none',
  output_quality        TEXT          NOT NULL DEFAULT 'standard',
  -- Preview/Full split
  mode                  TEXT          NOT NULL DEFAULT 'preview'
                                      CHECK (mode IN ('preview', 'full')),
  preview_duration_sec  INTEGER       DEFAULT 30,
  cached_analysis_json  JSONB,
  parent_job_id         UUID          REFERENCES render_jobs(id) ON DELETE SET NULL,
  idempotency_key       TEXT          UNIQUE,
  error_message         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'preview'
    CHECK (mode IN ('preview','full'));
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS preview_duration_sec INTEGER DEFAULT 30;
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS cached_analysis_json JSONB;
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES render_jobs(id) ON DELETE SET NULL;
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
DO $$ BEGIN
  CREATE UNIQUE INDEX uq_render_jobs_idempotency_key ON render_jobs(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL; WHEN others THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Final Outputs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS final_outputs (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID          UNIQUE NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  project_id        UUID          REFERENCES projects(id) ON DELETE SET NULL,
  preview_mp3_url   TEXT,         -- S3 key (full mode primary preview)
  full_wav_url      TEXT,         -- S3 key
  full_mp3_url      TEXT,         -- S3 key (HD MP3)
  -- Preview-mode (3 variant teaser clips)
  is_preview        BOOLEAN       NOT NULL DEFAULT FALSE,
  preview_a_url     TEXT,
  preview_b_url     TEXT,
  preview_c_url     TEXT,
  duration_seconds  FLOAT,
  loudness_lufs     FLOAT,
  sample_rate       INTEGER       DEFAULT 44100,
  bit_depth         SMALLINT      DEFAULT 16,
  file_size_bytes   BIGINT,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE final_outputs
  ADD COLUMN IF NOT EXISTS is_preview BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE final_outputs
  ADD COLUMN IF NOT EXISTS preview_a_url TEXT;
ALTER TABLE final_outputs
  ADD COLUMN IF NOT EXISTS preview_b_url TEXT;
ALTER TABLE final_outputs
  ADD COLUMN IF NOT EXISTS preview_c_url TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Payments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id  TEXT          UNIQUE,
  amount_cents              INTEGER       NOT NULL,
  currency                  TEXT          NOT NULL DEFAULT 'usd',
  status                    TEXT          NOT NULL DEFAULT 'pending',
  description               TEXT,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Processing Logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processing_logs (
  id          BIGSERIAL     PRIMARY KEY,
  job_id      UUID          REFERENCES render_jobs(id) ON DELETE CASCADE,
  level       TEXT          NOT NULL DEFAULT 'info',
  stage       TEXT,
  message     TEXT          NOT NULL,
  metadata    JSONB         DEFAULT '{}',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_user_id     ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at  ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_user_id       ON uploaded_tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_project_id    ON uploaded_tracks(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id         ON render_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project_id      ON render_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status          ON render_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at      ON render_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outputs_job_id       ON final_outputs(job_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id     ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_job_id          ON processing_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_subs_user_id         ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_track_id    ON analysis_results(track_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users','subscriptions','uploaded_tracks','projects','render_jobs']
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
