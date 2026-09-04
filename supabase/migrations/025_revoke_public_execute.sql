-- 025_revoke_public_execute.sql — two fixes found by re-auditing after 024:
--   (A) 024's function-grant revoke targeted the wrong role and did nothing.
--   (B) uploaded PDFs were never actually deleted from Storage — the app's
--       right-to-erasure claim was not true. THIS IS THE IMPORTANT ONE.
--
-- ===========================================================================
-- PART B FIRST, because it is the one with real privacy impact.
--
-- storage.objects had exactly two policies: SELECT and INSERT, both correctly
-- scoped to `(storage.foldername(name))[1] = auth.uid()`. There was NO DELETE
-- policy. With RLS enabled, no policy means deny — so every attempt to delete
-- a user's uploaded PDF was silently refused.
--
-- Measured on the live project before this migration:
--     files in storage : 83
--     document rows    : 30
--     ORPHANED files   : 65
--
-- Those 65 are PDFs whose owner deleted the document or the whole collection.
-- The database rows went away; the actual files stayed. `delete_collection` is
-- commented in main.py as "Right-to-erasure (ADR-013): a user-initiated,
-- complete delete ... and the actual uploaded PDF files in Storage, not just DB
-- rows." That was not happening. Docs claimed more than the code did — exactly
-- the failure mode this project treats as its top risk — and it went unnoticed
-- because the delete call never checked its HTTP status (fixed in main.py
-- alongside this migration).
--
-- The policy below mirrors the existing SELECT/INSERT ones exactly, so a user
-- can delete files in their own folder and nowhere else.
-- ===========================================================================
drop policy if exists "Users can delete their own documents" on storage.objects;
create policy "Users can delete their own documents"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- NOTE ON THE 65 EXISTING ORPHANS: this migration does NOT delete them.
-- Removing user data is irreversible and is Clint's call, not a side effect of
-- a schema change. They are listed for review by the query in the session notes;
-- deleting them is a one-line Storage operation once he decides.

-- ===========================================================================
-- PART A — the function-grant bug in migration 024.
-- ===========================================================================
--
-- WHAT 024 GOT WRONG. It tried to stop three SECURITY DEFINER trigger functions
-- from being callable over the REST API and did this:
--
--     revoke all on function <fn> from anon, authenticated;
--
-- That had no effect, and re-running Supabase's linter after 024 proved it —
-- the same four warnings came back unchanged. The reason is that PostgreSQL
-- grants EXECUTE on every new function to **PUBLIC** by default, and `anon` and
-- `authenticated` inherit it from there. Revoking a grant those roles never
-- held individually changes nothing. Confirmed by reading the ACL directly:
--
--     handle_new_user_profile -> {=X/postgres, postgres=X/postgres}
--                                 ^ empty grantee = PUBLIC still holds EXECUTE
--
-- The correct target is PUBLIC. This is a good example of why the linter is
-- worth re-running after a fix instead of trusting that the fix did what its
-- name says.
--
-- IMPACT, stated honestly: these are TRIGGER functions (they return `trigger`).
-- PostgREST cannot meaningfully invoke them — calling one outside a trigger
-- context errors out rather than doing anything — so this was surface, not an
-- exploitable hole. It is still the wrong default for a SECURITY DEFINER
-- function reachable by an unauthenticated role, which is why it gets fixed
-- rather than argued away.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions: nobody should be able to call these over the API.
--    They keep working as triggers — a trigger fires as the table owner and
--    does not consult EXECUTE grants at all.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('handle_new_user_profile',
                        'handle_new_user_usage_limits',
                        'rls_auto_enable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. bump_chat_usage: KEEP anon's access — but grant it deliberately.
--
--    This one is genuinely called by the backend over the anon key, because the
--    landing-page chatbot is unauthenticated by design (ADR-021). Migration 016
--    documented that intent, but the function was ALSO exposed to PUBLIC and to
--    `authenticated` by the default grant, which was never intended.
--
--    Revoke the blanket default, then re-grant to exactly one role. The linter
--    will still flag it — correctly, because it IS an anon-callable SECURITY
--    DEFINER function. That warning is now an accepted, documented decision
--    rather than an accident.
--
--    Residual risk, unchanged and known: anyone can POST to
--    /rest/v1/rpc/bump_chat_usage and increment the day's chat counter, burning
--    the global daily chatbot allowance without ever sending a message. The
--    blast radius is the public chatbot going quiet for the rest of the day —
--    no data is exposed and nothing else degrades. Closing it properly means
--    moving the counter behind the backend's own service credentials, which is
--    a Phase 4b change, not a one-line fix.
-- ---------------------------------------------------------------------------
revoke all on function public.bump_chat_usage() from public, anon, authenticated;
grant execute on function public.bump_chat_usage() to anon;

-- ---------------------------------------------------------------------------
-- 3. Retrieval RPCs: same blanket-PUBLIC default, same tightening.
--    These are SECURITY INVOKER (RLS applies to the caller), so PUBLIC access
--    was never a data-exposure path — an anonymous caller has no rows. Scoped to
--    `authenticated` anyway so the grant matches the intent.
-- ---------------------------------------------------------------------------
revoke all on function public.match_document_chunks(vector, uuid, int) from public, anon;
revoke all on function public.hybrid_match_chunks(vector, text, uuid, int, float, float, int) from public, anon;
grant execute on function public.match_document_chunks(vector, uuid, int) to authenticated;
grant execute on function public.hybrid_match_chunks(vector, text, uuid, int, float, float, int) to authenticated;
