-- ============================================================
-- Migration 017: Drop legacy MashFusion AI tables
-- ============================================================
--
-- ⚠️ WARNING — DO NOT APPLY WITHOUT FULL DATABASE BACKUP ⚠️
--
-- Status:  PREPARED, NOT APPLIED
-- Created: as part of "IOMIXO Live Hub focus" cleanup branch
-- Branch:  cleanup/remove-legacy-ai
--
-- This migration removes all PostgreSQL tables that supported
-- the OLD MashFusion AI Studio (audio upload → analysis → stem
-- separation → mashup render → download). All the backend code
-- and frontend UI that wrote to / read from these tables has
-- already been removed in this branch.
--
-- The tables below are now ORPHANED (no application code
-- references them). They are safe to drop, but the operation
-- is IRREVERSIBLE without a backup.
--
-- BEFORE APPLYING — checklist:
--   1.  Take a full backup of the Supabase Postgres database
--       (Supabase Dashboard → Database → Backups → Download).
--   2.  Confirm in staging that IOMIXO Live Hub + DJ sessions
--       + Wedding Edition + Event Pass 24H still work without
--       these tables (they should — no live code touches them).
--   3.  Check Supabase Storage for orphan buckets
--       (uploads, outputs, stems, soundbank, user-samples) —
--       those may also be deleted manually.
--   4.  Apply this migration during a maintenance window.
--
-- HOW TO APPLY (when ready):
--   psql "$SUPABASE_DB_URL" -f 017_drop_legacy_ai_tables.sql
--
-- ============================================================

BEGIN;

-- Worker infrastructure (migration 002)
DROP TABLE IF EXISTS job_temp_files CASCADE;
DROP TABLE IF EXISTS job_cost_tracking CASCADE;
DROP TABLE IF EXISTS worker_nodes CASCADE;
DROP TABLE IF EXISTS job_checkpoints CASCADE;
DROP TABLE IF EXISTS processing_logs CASCADE;

-- Workstation + arrangement (migration 005)
DROP TABLE IF EXISTS arrangements CASCADE;
DROP TABLE IF EXISTS stems CASCADE;

-- Soundbank + user samples (migration 006)
DROP TABLE IF EXISTS user_samples CASCADE;
DROP TABLE IF EXISTS soundbank_samples CASCADE;

-- Core AI pipeline (schema.sql)
DROP TABLE IF EXISTS final_outputs CASCADE;
DROP TABLE IF EXISTS analysis_results CASCADE;
DROP TABLE IF EXISTS render_jobs CASCADE;
DROP TABLE IF EXISTS uploaded_tracks CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

COMMIT;

-- ============================================================
-- After this migration runs, the following are also safe to
-- remove manually (NOT included here for safety):
--   - Supabase Storage buckets: uploads, outputs, stems,
--     soundbank, user-samples
--   - Any Postgres functions/triggers referencing the above
--     tables (none expected — verify with \df in psql)
-- ============================================================
