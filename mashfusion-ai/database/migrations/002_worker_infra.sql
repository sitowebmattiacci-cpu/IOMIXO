-- ═══════════════════════════════════════════════════════════════
--  Migration 002: Worker Infrastructure Tables
--  Adds: job_checkpoints, worker_nodes, job_cost_tracking,
--        job_temp_files
--  Run AFTER schema.sql (migration 001)
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- Job Checkpoints
-- Allows resuming a failed job from last completed stage.
-- Workers write a checkpoint after each stage completes.
-- On retry, the task reads the checkpoint and skips done stages.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_checkpoints (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID          NOT NULL UNIQUE
                                    REFERENCES render_jobs(id) ON DELETE CASCADE,
  -- Full stage_progress JSONB (same shape as render_jobs.stage_progress)
  stage_progress      JSONB         NOT NULL DEFAULT '{}',
  -- Last stage that successfully completed
  last_completed_stage TEXT,
  -- S3 keys for any intermediate files already uploaded (avoids re-upload on retry)
  intermediate_keys   JSONB         NOT NULL DEFAULT '{}',
  -- Which Celery worker node is/was handling this job
  worker_hostname     TEXT,
  -- How many times the task has been retried
  retry_count         SMALLINT      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_updated_at_job_checkpoints
  BEFORE UPDATE ON job_checkpoints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_checkpoints_job_id
  ON job_checkpoints(job_id);


-- ─────────────────────────────────────────────────────────────
-- Worker Node Registry
-- Celery workers register themselves on startup and send
-- heartbeats every 30 s. Beat task prunes stale entries.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_nodes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Celery hostname (e.g. "gpu-worker@hostname")
  worker_id       TEXT          UNIQUE NOT NULL,
  worker_type     TEXT          NOT NULL
                                CHECK (worker_type IN ('gpu', 'cpu', 'cleanup', 'beat')),
  -- Comma-separated queue names this worker listens to
  queues          TEXT[]        NOT NULL DEFAULT '{}',
  status          TEXT          NOT NULL DEFAULT 'online'
                                CHECK (status IN ('online', 'idle', 'offline', 'draining')),
  -- Job currently being processed (NULL if idle)
  current_job_id  UUID          REFERENCES render_jobs(id) ON DELETE SET NULL,
  jobs_completed  INTEGER       NOT NULL DEFAULT 0,
  jobs_failed     INTEGER       NOT NULL DEFAULT 0,
  -- CPU/GPU utilization at last heartbeat (0-100)
  cpu_pct         SMALLINT,
  gpu_pct         SMALLINT,
  memory_mb       INTEGER,
  last_heartbeat  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_nodes_status
  ON worker_nodes(status);
CREATE INDEX IF NOT EXISTS idx_worker_nodes_heartbeat
  ON worker_nodes(last_heartbeat DESC);


-- ─────────────────────────────────────────────────────────────
-- Job Temporary Files
-- Tracks every intermediate file written to /tmp and any
-- stems uploaded to S3 processing/ prefix.
-- Cleanup worker reads this table to know what to delete.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_temp_files (
  id              BIGSERIAL     PRIMARY KEY,
  job_id          UUID          NOT NULL
                                REFERENCES render_jobs(id) ON DELETE CASCADE,
  -- Either a local absolute path OR an S3 key
  file_path       TEXT          NOT NULL,
  file_type       TEXT          NOT NULL
                                CHECK (file_type IN (
                                  'original',    -- raw uploaded audio
                                  'stem',        -- separated stem (vocals/drums/etc)
                                  'intermediate',-- mashup_raw, mashup_styled, etc.
                                  'preview',     -- preview.mp3
                                  'output'       -- final master.wav / full.mp3
                                )),
  storage_backend TEXT          NOT NULL DEFAULT 'local'
                                CHECK (storage_backend IN ('local', 's3')),
  size_bytes      BIGINT        DEFAULT 0,
  deleted         BOOLEAN       NOT NULL DEFAULT FALSE,
  -- When this file should be eligible for cleanup
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_temp_files_job_id
  ON job_temp_files(job_id);
CREATE INDEX IF NOT EXISTS idx_temp_files_expires_pending
  ON job_temp_files(expires_at)
  WHERE deleted = FALSE AND expires_at IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- Job Cost Tracking
-- Records resource consumption per job for billing analytics
-- and infrastructure cost attribution.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_cost_tracking (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                    UUID          NOT NULL UNIQUE
                                          REFERENCES render_jobs(id) ON DELETE CASCADE,
  user_plan                 TEXT          NOT NULL,
  -- Worker time
  gpu_seconds               INTEGER       DEFAULT 0,
  cpu_seconds               INTEGER       DEFAULT 0,
  -- Storage (bytes)
  s3_bytes_temp             BIGINT        DEFAULT 0,  -- stems + intermediates
  s3_bytes_output           BIGINT        DEFAULT 0,  -- preview + final files
  -- Computed cost in USD (for internal analytics, NOT billed directly)
  -- GPU: ~$0.00025/s (A4000 RunPod spot), CPU: ~$0.000005/s
  estimated_cost_usd        NUMERIC(10,6) DEFAULT 0,
  -- Worker that processed this job
  worker_hostname           TEXT,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_tracking_job_id
  ON job_cost_tracking(job_id);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_created_at
  ON job_cost_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_tracking_plan
  ON job_cost_tracking(user_plan);


-- ─────────────────────────────────────────────────────────────
-- Helper view: active jobs with cost + worker info
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW active_job_overview AS
SELECT
  rj.id             AS job_id,
  rj.user_id,
  rj.status,
  rj.progress,
  rj.current_stage,
  rj.created_at,
  rj.started_at,
  jc.last_completed_stage,
  jc.retry_count,
  wn.worker_id,
  wn.worker_type,
  wn.gpu_pct,
  wn.cpu_pct,
  ct.gpu_seconds,
  ct.cpu_seconds,
  ct.estimated_cost_usd
FROM render_jobs rj
LEFT JOIN job_checkpoints  jc ON jc.job_id   = rj.id
LEFT JOIN worker_nodes     wn ON wn.current_job_id = rj.id
LEFT JOIN job_cost_tracking ct ON ct.job_id  = rj.id
WHERE rj.status IN ('queued', 'processing');
