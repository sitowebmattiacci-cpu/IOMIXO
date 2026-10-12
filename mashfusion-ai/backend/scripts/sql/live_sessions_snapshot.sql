-- READ-ONLY. Run in Supabase SQL Editor; copy the single `snapshot` cell into a local file (e.g. snapshot-sessions-2026-10-12.json).
-- The file contains account data (owner ids, couple names, venues): keep it local, never commit it (.gitignore covers snapshot-*.json).
select jsonb_build_object(
  'format',      'iomixo.live_sessions.snapshot.v1',
  'generatedAt', now(),
  'count',       count(*),
  'sessions',    coalesce(jsonb_agg(jsonb_build_object(
    'id',                  s.id,
    'dj_id',               s.dj_id,
    'public_slug',         s.public_slug,
    'event_name',          s.event_name,
    'dj_name',             s.dj_name,
    'description',         s.description,
    'is_active',           s.is_active,
    'session_type',        s.session_type,
    'couple_names',        s.couple_names,
    'wedding_date',        s.wedding_date,
    'venue_name',          s.venue_name,
    'screen_mode_enabled', s.screen_mode_enabled,
    'guest_config',        s.guest_config,
    'screen_config',       s.screen_config,
    'roulette_penitenze',  s.roulette_penitenze,
    'shoe_game_questions', s.shoe_game_questions,
    'created_at',          s.created_at,
    'updated_at',          s.updated_at
  ) order by s.created_at, s.id), '[]'::jsonb)
) as snapshot
from live_sessions s;
