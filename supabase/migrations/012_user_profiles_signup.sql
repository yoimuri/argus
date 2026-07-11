-- 012_user_profiles_signup.sql: make user_profiles earn its place (2026-07-11
-- live review, findings #2/#3). The table was created in 001 as scaffolding
-- (id + display_name) but nothing ever wrote a row to it, so Studio browsing
-- showed bare user_id uuids everywhere with no way to tell accounts apart --
-- the actual account records live in auth.users, which the Table Editor
-- doesn't display. Fix: store email + display name here at signup, and
-- backfill existing accounts, so user_profiles becomes the human-readable
-- "which uuid is which person" reference when browsing any table in Studio.

alter table public.user_profiles
  add column if not exists email text;

-- Signup trigger: same SECURITY DEFINER pattern as 011's usage-limits trigger.
-- Works for email/password AND Google OAuth signups; for OAuth, display name
-- comes from the provider metadata (full_name, falling back to name).
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, user_profiles.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Backfill every account that already exists (email/password test accounts and
-- the Google account created before this migration).
insert into public.user_profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      display_name = coalesce(excluded.display_name, user_profiles.display_name);
