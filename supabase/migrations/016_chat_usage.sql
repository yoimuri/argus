-- 016_chat_usage.sql: persisted global daily cap for the public project-Q&A
-- chatbot (Sprint 4.5, ADR-021). The chatbot is UNAUTHENTICATED, so there is
-- no user token to scope a per-user limit -- the cost surface is "anyone on the
-- internet spamming Gemini quota the owner pays for". Two limits guard it: an
-- in-process per-IP sliding window (backend/main.py, resets on dyno restart,
-- stated honestly) and this PERSISTED global daily counter (survives restarts,
-- the real quota protection).
--
-- The backend calls this over the anon key (no user token on a public
-- endpoint), so the table itself is locked down and only a SECURITY DEFINER
-- function can touch it -- anon can invoke the function (which atomically
-- increments and returns today's count) but can never read or write the table
-- directly, so it can't reset or inspect the counter.

create table if not exists public.chat_usage (
  day   date primary key,
  count int not null default 0
);

alter table public.chat_usage enable row level security;
-- No policies and no direct grants: the table is reachable ONLY through the
-- function below. (RLS with no policy = deny-all for anon/authenticated.)

create or replace function public.bump_chat_usage()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  new_count int;
begin
  insert into public.chat_usage (day, count) values (today, 1)
  on conflict (day) do update set count = chat_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;

-- The unauthenticated backend call runs as the anon role (publishable key, no
-- bearer). Let anon EXECUTE the function only.
grant execute on function public.bump_chat_usage() to anon;
