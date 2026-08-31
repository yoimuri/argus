-- 024_security_perf_hardening.sql — audit-driven hardening pass.
-- Sprint 4.9 (2026-08-31). Every item below came from Supabase's own database
-- linter (security + performance advisors) run against the live project, plus
-- one finding the linter does not check for (item 2).
--
-- Nothing here changes application behaviour. It removes privileges nothing
-- uses, makes the existing access rules cheaper to evaluate, and indexes the
-- foreign keys the app actually queries on.

-- ---------------------------------------------------------------------------
-- 1. Drop unused table privileges from anon / authenticated.
--
--    Supabase's default grants leave REFERENCES, TRIGGER and TRUNCATE on every
--    table in `public` for both API roles. This project already revoked the DML
--    it doesn't want, so what remains is unused surface.
--
--    HONEST SCOPE: this is defence in depth, NOT the closing of a live hole.
--    PostgREST only exposes SELECT/INSERT/UPDATE/DELETE and RPC — it has no
--    TRUNCATE, REFERENCES or TRIGGER verb, so none of these were reachable
--    through the API with an anon or user token. They would only matter to
--    someone who already had raw SQL access, who would have bigger levers. The
--    reason to drop them anyway: TRUNCATE bypasses RLS entirely, so leaving it
--    granted means any FUTURE change that widens SQL reach (a new SECURITY
--    DEFINER helper, a service-role slip) inherits a way to wipe a table —
--    including security_events. Least privilege closes that door in advance.
-- ---------------------------------------------------------------------------
--    Driven off pg_class rather than a hardcoded list so it covers every table
--    that exists now and cannot drift or fail on a name that changed. Restricted
--    to relkind='r' (ordinary tables): TRUNCATE is a table-only privilege, and
--    public.usage_limits_readable is a VIEW.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. security_events: make the LOG APPEND-ONLY for its own subject.
--
--    Found by reading the policies, not by the linter. The table carried a
--    `for all` policy (`own security events`) alongside the intended
--    select/insert pair. Table grants happen to stop UPDATE/DELETE today
--    (authenticated holds only INSERT + SELECT), so this was not exploitable —
--    but policy and grant disagreed, and the safe half was the one nobody
--    documented. A single future `grant update` would have silently let the
--    party being logged edit or delete their own injection-attempt records.
--
--    Now the policy says what the design means: you may write your own events
--    and read your own events. Nothing else. This also resolves the linter's
--    multiple_permissive_policies warnings on this table (three overlapping
--    policies collapse to two non-overlapping ones).
--
--    Still true and still documented in ADR/migration 004: the backend writes
--    these rows with the END USER's token, so the subject controls the write
--    path. Real tamper-evident logging needs a service-role writer from a
--    trusted context. That remains a known, stated limitation.
-- ---------------------------------------------------------------------------
drop policy if exists "own security events" on public.security_events;

-- ---------------------------------------------------------------------------
-- 3. RLS performance: evaluate auth.uid() ONCE per query, not once per row.
--
--    `auth.uid()` inside a policy is re-evaluated for every candidate row
--    (linter: auth_rls_initplan). Wrapping it in a scalar subquery lets the
--    planner hoist it to an InitPlan and run it a single time. Identical
--    semantics, materially cheaper on the big tables — document_chunks is the
--    one that matters here, since vector + full-text search scan hundreds of
--    rows per question and every one of them was calling auth.uid().
--
--    Policies are recreated verbatim apart from that wrapping. `for all`
--    policies keep USING as their INSERT check exactly as before (Postgres
--    reuses USING when WITH CHECK is omitted); it is written explicitly here so
--    the intent is visible rather than implied.
-- ---------------------------------------------------------------------------
drop policy if exists "own collections" on public.collections;
create policy "own collections" on public.collections
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own chunks" on public.document_chunks;
create policy "own chunks" on public.document_chunks
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own documents" on public.documents;
create policy "own documents" on public.documents
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own execution steps" on public.execution_steps;
create policy "own execution steps" on public.execution_steps
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own sessions" on public.research_sessions;
create policy "own sessions" on public.research_sessions
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "own profile" on public.user_profiles;
create policy "own profile" on public.user_profiles
  for all using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "own reports select" on public.reports;
create policy "own reports select" on public.reports
  for select using (user_id = (select auth.uid()));

drop policy if exists "own reports insert" on public.reports;
create policy "own reports insert" on public.reports
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "own reports update" on public.reports;
create policy "own reports update" on public.reports
  for update using (user_id = (select auth.uid()));

drop policy if exists "own reports delete" on public.reports;
create policy "own reports delete" on public.reports
  for delete using (user_id = (select auth.uid()));

drop policy if exists "read own security events" on public.security_events;
create policy "read own security events" on public.security_events
  for select using (user_id = (select auth.uid()));

drop policy if exists "insert own security events" on public.security_events;
create policy "insert own security events" on public.security_events
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "own usage events read" on public.usage_events;
create policy "own usage events read" on public.usage_events
  for select using (user_id = (select auth.uid()));

drop policy if exists "own usage events insert" on public.usage_events;
create policy "own usage events insert" on public.usage_events
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "own usage limits" on public.usage_limits;
create policy "own usage limits" on public.usage_limits
  for select using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Pin search_path on the retrieval functions (linter:
--    function_search_path_mutable). Without it the function resolves unqualified
--    names against the CALLER's search_path, so an object planted in an earlier
--    schema could shadow one it depends on. Neither function is SECURITY
--    DEFINER, which caps the impact, but pinning is free and removes the class.
--    Recreated with ALTER so the bodies (migration 003 / 023) stay untouched.
-- ---------------------------------------------------------------------------
alter function public.match_document_chunks(vector, uuid, int)
  set search_path = public, pg_temp;
alter function public.hybrid_match_chunks(vector, text, uuid, int, float, float, int)
  set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 5. Trigger functions must not be callable as RPC (linter:
--    anon/authenticated_security_definer_function_executable).
--
--    handle_new_user_profile / handle_new_user_usage_limits run as SECURITY
--    DEFINER triggers on auth.users. They are fired BY POSTGRES, never by a
--    client, but Supabase's default EXECUTE grant published them at
--    /rest/v1/rpc/<name>. A trigger function called outside a trigger context
--    errors rather than doing damage, so this is hardening, not a patched
--    breach — but a SECURITY DEFINER function reachable by anon is exactly the
--    surface you do not leave open by accident.
-- ---------------------------------------------------------------------------
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('handle_new_user_profile','handle_new_user_usage_limits','rls_auto_enable')
  loop
    execute format('revoke all on function %s from anon, authenticated', fn.sig);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Index the foreign keys the app actually filters on (linter:
--    unindexed_foreign_keys).
--
--    document_chunks(document_id) is the important one: the report generator
--    fetches every chunk of every document one document at a time, and the
--    retriever's lead-chunk lookup filters the same way. Without this index
--    each of those is a sequential scan over the whole chunk table. The rest
--    are cheap and prevent the same shape of problem as data grows.
-- ---------------------------------------------------------------------------
create index if not exists document_chunks_document_id_idx on public.document_chunks (document_id);
create index if not exists document_chunks_user_id_idx     on public.document_chunks (user_id);
create index if not exists documents_collection_id_idx     on public.documents (collection_id);
create index if not exists documents_user_id_idx           on public.documents (user_id);
create index if not exists collections_user_id_idx         on public.collections (user_id);
create index if not exists execution_steps_user_id_idx     on public.execution_steps (user_id);
create index if not exists reports_collection_id_idx       on public.reports (collection_id);
create index if not exists research_sessions_user_id_idx   on public.research_sessions (user_id);
create index if not exists research_sessions_collection_id_idx on public.research_sessions (collection_id);
