-- 017_reports.sql: Sprint 4.6a — Report Generation (D17, ADR-022).
--
-- Two parts:
--   1. A `reports` table: one row per generated report. The row is created
--      BEFORE generation starts (status 'running') and the backend's
--      background task patches it to completed/error — the frontend polls
--      this row instead of holding a multi-minute HTTP request open (Render's
--      proxy already proved it can't be trusted with long synchronous
--      requests during the Sprint 4.3 cancel rework). Cancel = the same
--      DB-signal pattern as research: flip status to 'cancelled', the
--      generator checks the flag between model calls.
--   2. A `max_reports_per_day` cap on usage_limits. Report generation is the
--      costliest flow in the app (many Groq calls incl. the large model, plus
--      a possible Tavily lookup per run), so its metering is load-bearing.
--      Metering counts usage_events with event_type='report' (migration 014
--      was designed for exactly this — append-only, no user-delete, survives
--      collection deletes), NOT this table: reports are user-visible,
--      deletable HISTORY, and deleting one must not refund the daily cap.

create table if not exists public.reports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- SET NULL, not CASCADE: a report is a deliverable the user generated; it
  -- should survive its source collection being deleted. collection_name is
  -- snapshotted at creation so the report stays labeled after that.
  collection_id   uuid references public.collections(id) on delete set null,
  collection_name text not null default '',
  title           text,
  domain          text,               -- e.g. 'cybersecurity', 'data_science', or a looked-up label
  template_source text,               -- 'built_in' | 'web_lookup' | 'general'
  content_md      text,               -- the generated report, Markdown
  status          text not null default 'running',  -- running | completed | error | cancelled
  created_at      timestamptz not null default now()
);

create index if not exists reports_user_time_idx
  on public.reports (user_id, created_at desc);

alter table public.reports enable row level security;

-- Own-rows-only, all four verbs: the backend writes these rows with the
-- USER'S token (same trust model as research_sessions), so insert/update need
-- policies too. Update/delete on your own report is legitimate (cancel flips
-- status; users may delete their own history) — the un-forgeable accounting
-- lives in usage_events, not here.
drop policy if exists "own reports select" on public.reports;
create policy "own reports select" on public.reports
  for select using (user_id = auth.uid());

drop policy if exists "own reports insert" on public.reports;
create policy "own reports insert" on public.reports
  for insert with check (user_id = auth.uid());

drop policy if exists "own reports update" on public.reports;
create policy "own reports update" on public.reports
  for update using (user_id = auth.uid());

drop policy if exists "own reports delete" on public.reports;
create policy "own reports delete" on public.reports
  for delete using (user_id = auth.uid());

-- Explicit grants (nothing is auto-exposed in this project — migration 002).
grant select, insert, update, delete on public.reports to authenticated;

-- Free-tier cap for report generation. Existing rows get the tight default 3
-- from the ADD COLUMN; the backfill below then raises every account that
-- exists TODAY to the owner/QA tier (same pattern as migration 011's
-- backfill) so Clint's live testing isn't blocked by his own cap. Genuinely
-- new signups after this migration get the tight default.
alter table public.usage_limits
  add column if not exists max_reports_per_day int not null default 3;

update public.usage_limits set max_reports_per_day = 100;
