-- ═══════════════════════════════════════════════════════════════
--  Migration 003: Remix Director + Status Constraint Fix
--  Adds: remix_prompt, remix_director_params columns
--        Fixes: render_jobs.status CHECK to include 'expired'
-- ═══════════════════════════════════════════════════════════════

-- ── remix_prompt and interpreted params on projects ───────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS remix_prompt         TEXT,
  ADD COLUMN IF NOT EXISTS remix_director_params JSONB DEFAULT '{}';

-- ── same columns on render_jobs (denormalized for worker access) ─
ALTER TABLE render_jobs
  ADD COLUMN IF NOT EXISTS remix_prompt         TEXT,
  ADD COLUMN IF NOT EXISTS remix_director_params JSONB DEFAULT '{}';

-- ── Fix render_jobs.status CHECK to include 'expired' ─────────
ALTER TABLE render_jobs
  DROP CONSTRAINT IF EXISTS render_jobs_status_check;

ALTER TABLE render_jobs
  ADD CONSTRAINT render_jobs_status_check
  CHECK (status IN ('queued','processing','complete','failed','canceled','expired'));

-- ── Index for prompt analytics (optional) ────────────────────
CREATE INDEX IF NOT EXISTS idx_jobs_has_prompt
  ON render_jobs ((remix_prompt IS NOT NULL))
  WHERE remix_prompt IS NOT NULL;
