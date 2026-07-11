-- 011_usage_limits.sql: Sprint 4.4 (D13). Per-user free-tier caps, enforced by
-- the backend (upload/collection/research handlers) and VISIBLE to the user in
-- the dashboard. A public signup surface (Google OAuth, Sprint 4.4) must not
-- open unmetered free-tier usage: every generation is Groq + HF quota the owner
-- pays for, so metering is load-bearing, not cosmetic.
--
-- Trust model: clients get SELECT only (see below) so a user can read their own
-- limits but can NEVER raise them from the browser. The owner raises a user's
-- caps by editing the row directly in Supabase Studio -- no admin UI until 4b.

create table if not exists public.usage_limits (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  -- Tight defaults = the public free-tier tier. New signups get these via the
  -- trigger below; existing accounts are backfilled to the owner/QA tier so
  -- Clint's ongoing Phase 4 testing is never blocked by his own limits.
  max_collections      int not null default 3,
  max_documents        int not null default 15,
  max_research_per_day int not null default 15,
  updated_at           timestamptz default now()
);

-- RLS: a user may READ their own limits (the dashboard meter needs this) and
-- nothing else. No insert/update/delete policy AND no write grant below, so the
-- caps are un-forgeable from a user token -- only the SECURITY DEFINER trigger
-- and the owner (via Studio / service role) can write them.
alter table public.usage_limits enable row level security;
drop policy if exists "own usage limits" on public.usage_limits;
create policy "own usage limits" on public.usage_limits
  for select using (user_id = auth.uid());

-- Explicit grants (this project auto-exposes nothing -- see migration 002).
-- SELECT only: no INSERT/UPDATE/DELETE to authenticated, so clients cannot
-- change their own caps.
grant select on public.usage_limits to authenticated;

-- New accounts (email OR Google OAuth) get a default-limits row automatically.
-- SECURITY DEFINER so the trigger can insert regardless of the new user's own
-- (nonexistent-yet) privileges; search_path pinned to public to keep it from
-- resolving unqualified names anywhere unexpected.
create or replace function public.handle_new_user_usage_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_limits (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_usage_limits on auth.users;
create trigger on_auth_user_created_usage_limits
  after insert on auth.users
  for each row execute function public.handle_new_user_usage_limits();

-- Backfill everyone who already exists at the owner/QA tier (high), so no
-- current test account is suddenly capped mid-testing. Genuinely new public
-- signups after this migration get the tight defaults from the column defaults
-- via the trigger, not this backfill.
insert into public.usage_limits (user_id, max_collections, max_documents, max_research_per_day)
select id, 100, 500, 500 from auth.users
on conflict (user_id) do nothing;
