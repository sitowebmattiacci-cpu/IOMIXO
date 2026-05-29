-- ─────────────────────────────────────────────────────────────────────────────
-- 015_advance_rebrand.sql
-- IOMIXO Live Hub — Advance rebrand.
-- - Adds 'party' as a valid live session_type (alongside 'standard' and 'wedding').
-- - Normalises legacy plan values (pro_plus, premium_wedding, wedding_edition_plan,
--   club, studio) onto the canonical 'wedding' tier (displayed as "Advance").
-- - Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Plan normalisation: collapse all legacy aliases onto 'wedding' ───────────
ALTER TABLE users         DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

UPDATE users
   SET plan = 'wedding'
 WHERE plan IN ('pro_plus', 'premium_wedding', 'wedding_edition_plan', 'club', 'studio', 'advance');

UPDATE subscriptions
   SET plan = 'wedding'
 WHERE plan IN ('pro_plus', 'premium_wedding', 'wedding_edition_plan', 'club', 'studio', 'advance');

ALTER TABLE users
  ADD CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro', 'wedding'));

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('free', 'pro', 'wedding'));

-- ── live_sessions: allow 'party' as a session_type ───────────────────────────
ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_session_type_check;
ALTER TABLE live_sessions
  ADD CONSTRAINT live_sessions_session_type_check
  CHECK (session_type IN ('standard', 'party', 'wedding'));

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notes
-- ─────────────────────────────────────────────────────────────────────────────
-- • The DB plan key remains 'wedding' for backward compatibility; the UI labels
--   it as "Advance". Legacy aliases are still accepted by the backend
--   `normalizePlan()` helper (see backend/src/config/plans.ts).
-- • 'party' sessions reuse the existing live_sessions infrastructure. They are
--   available to users on the Advance plan (`PLAN_LIMITS.wedding.weddingMode`).
-- ─────────────────────────────────────────────────────────────────────────────
