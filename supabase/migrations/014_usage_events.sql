-- 014_usage_events.sql: fix the research-cap bypass (2026-07-11 live review).
--
-- The bug: the daily research cap counted rows in research_sessions, but those
-- rows CASCADE-DELETE when their collection is deleted (001's `on delete
-- cascade`). So a user at their daily limit could delete a collection, wipe the
-- session rows the count was based on, and immediately run more -- the rate
-- limit was effectively tracked "by collection" and died with it.
--
-- The fix: usage is a RATE-LIMIT concern, separate from research_sessions
-- (which is user-visible, deletable HISTORY, subject to right-to-erasure). This
-- append-only accounting table records one row per real research run, with NO
-- foreign key to collections (so deleting a collection can't touch it) and no
-- user-facing delete path (so a user can't reset their own usage). The daily
-- cap counts THIS table instead of research_sessions.
--
-- (Note: collections/documents caps are OWNERSHIP quotas -- a count of live
-- rows you hold, correctly enforced per-user; delete-and-recreate keeps you at
-- or under the cap and is legitimate. Only the per-day research RATE limit had
-- the deletable-evidence bypass. So only research logs here.)
--
-- `event_type` is included (not hardcoded) so Sprint 4.6's report generation
-- can meter through the same table without a schema change.

create table if not exists public.usage_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_type text not null,                 -- 'research' today; 'report' later (4.6)
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_time_idx
  on public.usage_events (user_id, event_type, created_at);

alter table public.usage_events enable row level security;

-- Users may READ their own events (the dashboard/workspace usage meters need
-- this) and INSERT their own (the backend logs through the user's token).
-- There is deliberately NO update/delete policy and NO update/delete grant:
-- that is what makes usage un-forgeable downward -- a user cannot erase their
-- own events to reset the count, which is the entire point of this table.
-- (Inserting extra events would only raise their own usage, i.e. self-limit,
-- so an insert policy is safe.)
drop policy if exists "own usage events read" on public.usage_events;
create policy "own usage events read" on public.usage_events
  for select using (user_id = auth.uid());

drop policy if exists "own usage events insert" on public.usage_events;
create policy "own usage events insert" on public.usage_events
  for insert with check (user_id = auth.uid());

grant select, insert on public.usage_events to authenticated;
