-- READ-ONLY. Run in Supabase SQL Editor; copy the single `snapshot` cell into a local file (e.g. snapshot-history-2026-10-12.json).
-- Contains guest content (song requests, dedication messages, poll answers) and owner ids: keep it local, never commit it
-- (.gitignore covers snapshot-*.json). Hashed IPs are NOT exported; the only voter identity kept is the Firebase uid of callable votes ('fb:<uid>').
select jsonb_build_object(
  'format',      'iomixo.event_history.snapshot.v1',
  'generatedAt', now(),
  'counts', jsonb_build_object(
    'sessions',    (select count(*) from live_sessions),
    'requests',    (select count(*) from live_requests),
    'dedications', (select count(*) from live_dedications),
    'polls',       (select count(*) from live_polls),
    'votes',       (select count(*) from live_poll_votes)),
  'sessions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'dj_id', s.dj_id, 'public_slug', s.public_slug) order by s.created_at, s.id) from live_sessions s), '[]'::jsonb),
  'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'session_id', r.session_id, 'track_title', r.track_title, 'artist', r.artist,
                 'message', r.message, 'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at) order by r.created_at, r.id) from live_requests r), '[]'::jsonb),
  'dedications', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'session_id', d.session_id, 'guest_name', d.guest_name, 'message', d.message,
                 'status', d.status, 'created_at', d.created_at, 'updated_at', d.updated_at) order by d.created_at, d.id) from live_dedications d), '[]'::jsonb),
  'polls', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'session_id', p.session_id, 'question', p.question, 'options', p.options,
                 'is_active', p.is_active, 'created_at', p.created_at, 'updated_at', p.updated_at) order by p.created_at, p.id) from live_polls p), '[]'::jsonb),
  'votes', coalesce((select jsonb_agg(jsonb_build_object('poll_id', v.poll_id, 'option_index', v.option_index,
                 'voter', case when v.ip_hash like 'fb:%' then v.ip_hash else null end, 'created_at', v.created_at) order by v.created_at, v.id) from live_poll_votes v), '[]'::jsonb)
) as snapshot;
