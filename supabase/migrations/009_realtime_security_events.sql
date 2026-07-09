-- 009_realtime_security_events.sql
--
-- Sprint 4.1 (D8): publish security_events to Supabase Realtime so the
-- Phase 4 SOC dashboard's live events feed (Sprint 4.2) can subscribe to
-- postgres_changes INSERTs instead of polling.
--
-- No new RLS policy needed -- migration 004 already created "read own
-- security events" (select using user_id = auth.uid()), and Realtime
-- evaluates that same policy against the subscriber's JWT per row before
-- delivering a change, so each user's socket only ever receives their own
-- rows (GATE-20). security_events is insert-only (no update/delete path in
-- the code), so the default replica identity is fine -- Realtime only needs
-- old-row values for update/delete filtering, neither of which happens here.
--
-- Guarded via pg_publication_tables so re-running this migration (or
-- rebuilding a fresh database from the full migration set) doesn't error on
-- "relation is already member of publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'security_events'
  ) then
    alter publication supabase_realtime add table public.security_events;
  end if;
end $$;
