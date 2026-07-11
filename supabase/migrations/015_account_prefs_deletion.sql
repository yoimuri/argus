-- 015_account_prefs_deletion.sql: account-level preferences + the account
-- deletion flow (presentability pass increment 2, 2026-07-11; design in
-- docs/ADR-020.md).
--
-- theme_pref: the theme choice saved to the ACCOUNT (Clint: "toggle save, not
-- toggle only") -- localStorage keeps the instant-paint job, this makes the
-- choice follow the user across browsers/devices (adopted at login).
--
-- deletion_requested_at: set when the user requests account deletion (type-
-- DELETE confirm in Settings). 7-day grace period; clearing it back to null =
-- withdrawing the request. account_deleted_at: stamped when the grace period
-- expires and the purge runs -- once set, the dashboard signs the account out
-- on sight and the data is already gone (see ADR-020 for what "deleted" does
-- and does not cover without a service-role key).
--
-- No new grants needed: migration 002 already grants authenticated
-- select/insert/update/delete on user_profiles, and the "own profile" RLS
-- policy (001) scopes every write to the user's own row.

alter table public.user_profiles
  add column if not exists theme_pref text,
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists account_deleted_at timestamptz;
