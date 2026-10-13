-- READ-ONLY (a single SELECT). Run in Supabase SQL Editor; copy the single `snapshot` cell into a local file (e.g. snapshot-billing-2026-10-13.json).
-- Contains e-mails, Stripe customer / subscription / payment-intent ids and amounts of real accounts: keep it local, never commit it (.gitignore covers snapshot-*.json).
-- NOT exported: password hashes, verification / reset tokens, avatars, names. Stripe secret keys never live in the database.
-- subscriptions / payments / event_passes are exported with to_jsonb(row): EVERY column that really exists in production is included
-- (the schema drifted over migrations 008-016), and `columns` lists them so the shape can be checked before the migration is written.
select jsonb_build_object(
  'format',      'iomixo.billing.snapshot.v1',
  'generatedAt', now(),
  'counts', jsonb_build_object(
    'users',         (select count(*) from users),
    'usersBilling',  (select count(*) from users u
                       where u.stripe_customer_id is not null or u.plan <> 'free'
                          or exists (select 1 from subscriptions s where s.user_id = u.id)
                          or exists (select 1 from payments p where p.user_id = u.id)
                          or exists (select 1 from event_passes e where e.user_id = u.id)),
    'subscriptions', (select count(*) from subscriptions),
    'payments',      (select count(*) from payments),
    'eventPasses',   (select count(*) from event_passes)),
  'columns', coalesce((select jsonb_object_agg(t.table_name, t.cols)
                       from (select c.table_name, jsonb_agg(c.column_name order by c.ordinal_position) as cols
                             from information_schema.columns c
                             where c.table_schema = 'public' and c.table_name in ('users', 'subscriptions', 'payments', 'event_passes')
                             group by c.table_name) t), '{}'::jsonb),
  'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'plan', u.plan, 'stripe_customer_id', u.stripe_customer_id,
      'credits_remaining', u.credits_remaining, 'credits_reset_at', u.credits_reset_at,
      'created_at', u.created_at, 'updated_at', u.updated_at
    ) order by u.created_at, u.id)
    from users u
    where u.stripe_customer_id is not null or u.plan <> 'free'
       or exists (select 1 from subscriptions s where s.user_id = u.id)
       or exists (select 1 from payments p where p.user_id = u.id)
       or exists (select 1 from event_passes e where e.user_id = u.id)), '[]'::jsonb),
  'subscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at, s.id) from subscriptions s), '[]'::jsonb),
  'payments',      coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from payments p), '[]'::jsonb),
  -- cross-check only: Event Passes are already migrated to users/{uid}/eventPasses
  'eventPasses',   coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at, e.id) from event_passes e), '[]'::jsonb)
) as snapshot;
