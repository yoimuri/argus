-- 026_keepalive.sql — one tiny function so a scheduled ping can prove the
-- database is being used, and Supabase stops pausing the project.
--
-- THE PROBLEM. On the Free plan, Supabase pauses a project after 7 consecutive
-- days with no database activity, and a paused project takes the whole app down
-- until someone clicks restore in the dashboard. Opening the dashboard does NOT
-- count — only real queries and API requests do. For a portfolio project that
-- has to survive being unattended for weeks, that is a guaranteed outage on a
-- timer.
--
-- WHY A FUNCTION IS NEEDED AT ALL. The obvious keepalive is "SELECT one row from
-- some table with the anon key". That does not work here, and the reason is a
-- good sign rather than a bad one: this project grants `anon` no SELECT on any
-- table (verified 2026-09-04 — anon held only REFERENCES/TRIGGER/TRUNCATE, and
-- migration 024 revoked even those). An anonymous read would come back as a
-- permission error. Rather than weaken that, or introduce a service-role key
-- (the backend deliberately has none, so RLS is the only thing standing between
-- users' data and the internet), the ping gets one purpose-built function with
-- the smallest surface that can possibly work.
--
-- WHY IT IS SAFE:
--   * SECURITY INVOKER — runs as the caller, no privilege escalation, no RLS
--     bypass. This is the opposite of the SECURITY DEFINER functions migration
--     025 had to lock down.
--   * Returns a constant plus a timestamp. It reads no table, so there is no
--     data to leak — not even a row count.
--   * No writes, so no state to corrupt and no quota to burn. (Contrast
--     bump_chat_usage, which IS anon-callable and DOES have a side effect: it
--     increments the chatbot's daily allowance. Using that as a keepalive would
--     silently exhaust the public chatbot. This function exists precisely so
--     nothing with side effects gets used for the job.)
--   * Worst case abuse is someone calling it in a loop, which is ordinary
--     traffic against a function that does nothing.
--
-- VOLATILE + clock_timestamp() on purpose: a function returning a folded
-- constant could in principle be optimised away without the engine doing real
-- work. clock_timestamp() cannot be folded, so every call is a genuine query
-- executed inside Postgres — which, together with the PostgREST request that
-- carries it, is exactly the activity the pause timer is watching for.

create or replace function public.keepalive()
returns text
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select 'alive at ' || clock_timestamp()::text;
$$;

-- Strip the default blanket grant (PostgreSQL gives EXECUTE to PUBLIC on every
-- new function — the exact trap migration 024 fell into), then grant to the one
-- role that needs it. The cron calls this with the public anon key.
revoke all on function public.keepalive() from public, authenticated;
grant execute on function public.keepalive() to anon;
