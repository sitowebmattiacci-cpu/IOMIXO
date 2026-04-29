-- Fix SECURITY DEFINER on active_job_overview view.
-- Recreate with security_invoker=true so RLS policies are applied
-- with the permissions of the calling user, not the view creator.

DROP VIEW IF EXISTS active_job_overview;

CREATE OR REPLACE VIEW active_job_overview
  WITH (security_invoker = true)
AS
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
LEFT JOIN job_checkpoints   jc ON jc.job_id        = rj.id
LEFT JOIN worker_nodes      wn ON wn.current_job_id = rj.id
LEFT JOIN job_cost_tracking ct ON ct.job_id         = rj.id
WHERE rj.status IN ('queued', 'processing');

-- Grant access only to authenticated users (RLS will filter per-user)
GRANT SELECT ON active_job_overview TO authenticated;
REVOKE SELECT ON active_job_overview FROM anon;
