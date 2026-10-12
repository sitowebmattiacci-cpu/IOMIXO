-- READ-ONLY. Run in Supabase SQL Editor; copy the single `snapshot` cell into a local file (e.g. snapshot-photos-2026-10-13.json).
-- Contains guest names / captions and legacy Storage paths: keep it local, never commit it (.gitignore covers snapshot-*.json).
-- Hashed IPs are NOT exported. Votes are exported only as a count per photo (the Best Photo Contest has no UI in the app any more).
select jsonb_build_object(
  'format',      'iomixo.live_photos.snapshot.v1',
  'generatedAt', now(),
  'counts', jsonb_build_object(
    'photos',   (select count(*) from live_photos),
    'votes',    (select count(*) from live_photo_votes),
    'sessions', (select count(*) from live_sessions)),
  'photos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'session_id', p.session_id, 'guest_name', p.guest_name, 'caption', p.caption, 'storage_path', p.storage_path,
      'status', p.status, 'source', p.source, 'is_featured', p.is_featured, 'created_at', p.created_at, 'updated_at', p.updated_at
    ) order by p.created_at, p.id) from live_photos p), '[]'::jsonb),
  'votes', coalesce((select jsonb_agg(jsonb_build_object('photo_id', v.photo_id, 'count', v.n) order by v.photo_id)
                     from (select photo_id, count(*) as n from live_photo_votes group by photo_id) v), '[]'::jsonb),
  'sessions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'dj_id', s.dj_id, 'public_slug', s.public_slug, 'session_type', s.session_type,
      'show_photos', (s.screen_config->>'show_photos') = 'true',
      'winner_announcement', s.screen_config->'winner_announcement'
    ) order by s.created_at, s.id) from live_sessions s), '[]'::jsonb)
) as snapshot;
