-- ── 007_project_mode.sql ─────────────────────────────────────
-- Adds the project mode distinction:
--   'mashup' → two tracks, AI seeds an editable starting arrangement
--   'remix'  → one track, stems are separated, timeline starts empty
-- Existing rows are backfilled to 'mashup' (the only mode that existed
-- before this migration).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'mashup'
    CHECK (mode IN ('remix', 'mashup'));

CREATE INDEX IF NOT EXISTS idx_projects_mode ON projects(mode);
