-- READ-ONLY. Run in Supabase SQL Editor; copy the single `snapshot` cell into a local file (e.g. snapshot-profiles-2026-10-13.json).
-- Contains names, bios, public social links and avatar URLs of real accounts: keep it local, never commit it (.gitignore covers snapshot-*.json).
-- E-mail, plan, Stripe ids and credits are NOT exported (identity is matched through users/{uid}.legacySupabaseId; plan is already migrated).
select jsonb_build_object(
  'format',      'iomixo.profiles.snapshot.v1',
  'generatedAt', now(),
  'counts', jsonb_build_object(
    'users',       (select count(*) from users),
    'djProfiles',  (select count(*) from dj_profiles)),
  'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'updated_at', u.updated_at
    ) order by u.created_at, u.id) from users u
      where coalesce(u.full_name, '') <> '' or coalesce(u.avatar_url, '') <> ''), '[]'::jsonb),
  'djProfiles', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'display_name', p.display_name, 'bio', p.bio,
      'instagram_url', p.instagram_url, 'tiktok_url', p.tiktok_url, 'spotify_url', p.spotify_url,
      'soundcloud_url', p.soundcloud_url, 'website_url', p.website_url,
      'avatar_url', p.avatar_url, 'public_slug', p.public_slug, 'created_at', p.created_at, 'updated_at', p.updated_at
    ) order by p.created_at, p.user_id) from dj_profiles p), '[]'::jsonb)
) as snapshot;
