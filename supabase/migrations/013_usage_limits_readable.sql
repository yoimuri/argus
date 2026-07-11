-- 013_usage_limits_readable.sql: Studio-browsing convenience only (2026-07-11
-- live review). Migration 012 put email/display_name into user_profiles, but
-- that's a SEPARATE table from usage_limits -- Clint still had to
-- cross-reference two tables by hand to know whose row he was editing. This
-- view joins them so browsing `usage_limits_readable` in Studio shows the
-- email directly. Does not replace usage_limits: the backend and the
-- frontend usage meter/strip keep reading the bare table unchanged (D13's
-- SELECT-only trust model is untouched -- this view adds a read convenience,
-- it does not add a write path).
--
-- security_invoker = true (Postgres 15+, Supabase's baseline) makes the view
-- run with the QUERYING user's privileges/RLS, not the view creator's -- so a
-- normal user querying this view still only ever sees their own row, exactly
-- like usage_limits' own RLS policy. Clint browses as the `postgres` role in
-- Studio, which already bypasses RLS, so this is purely a display convenience
-- for him and changes nothing about what a real user can see.

create or replace view public.usage_limits_readable
with (security_invoker = true) as
select
  p.email,
  p.display_name,
  l.user_id,
  l.max_collections,
  l.max_documents,
  l.max_research_per_day,
  l.updated_at
from public.usage_limits l
left join public.user_profiles p on p.id = l.user_id
order by p.email;

grant select on public.usage_limits_readable to authenticated;
