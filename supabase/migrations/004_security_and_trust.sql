-- 004_security_and_trust.sql
--
-- RECONSTRUCTED MIGRATION — READ BEFORE RUNNING.
--
-- CONTINUITY.md and the Phase 2 build log say a "Migration 004" (trust_level +
-- security_events + an updated match_document_chunks RPC) was already applied to
-- the live Supabase project and "ran clean, confirmed." That SQL was never
-- committed to this repo — migrations 001–003 are here, 004 was not. This file
-- reconstructs 004 from exactly what the shipped code requires so the repo can
-- rebuild the database from scratch again (a real disaster-recovery property you
-- had silently lost).
--
-- Because the live project already has these objects, everything below is written
-- idempotently (IF NOT EXISTS / CREATE OR REPLACE / DROP+CREATE POLICY). It is safe
-- to run against a fresh database. Do NOT assume it byte-for-byte matches whatever
-- ad-hoc SQL was originally pasted into the live SQL editor — open the live schema
-- (Supabase → Database → Tables) and reconcile the two before trusting this as the
-- source of truth. Where the code did not pin a choice, the choice is commented.

-- ---------------------------------------------------------------------------
-- 1. trust_level on document_chunks
--    synthesizer.py reads c.get("trust_level", "retrieved"), so the column is
--    text with a default of 'retrieved'. Enum-like values used in the design:
--    user_query | retrieved | web_scraped | agent_gen.
-- ---------------------------------------------------------------------------
alter table document_chunks
  add column if not exists trust_level text not null default 'retrieved';

-- ---------------------------------------------------------------------------
-- 2. security_events — written by injection_guard.check_query() and
--    synthesizer.scan_chunks(). Columns actually inserted by the code:
--    user_id, event_type, source, detail. id/created_at added for triage.
-- ---------------------------------------------------------------------------
create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null,     -- e.g. query_injection_blocked, content_as_instruction
  source text,                  -- which layer/chunk flagged it
  detail text,                  -- first 300 chars of the offending content
  created_at timestamptz default now()
);

create index if not exists security_events_user_id_idx on security_events (user_id);
create index if not exists security_events_created_at_idx on security_events (created_at desc);

alter table security_events enable row level security;

-- INTEGRITY CAVEAT (documented, not silently accepted):
-- The backend logs security events using the END USER's own access_token, so the
-- INSERT policy below lets an authenticated user write rows for their own user_id.
-- That means the party being logged controls the write path — fine for a portfolio
-- SOC demo, NOT how you'd design tamper-evident security logging in production.
-- The production fix is to write these from the backend using the Supabase SERVICE
-- key (bypassing RLS) from a trusted server context, never the caller's token.
-- Tracked as a known gap; see the audit notes.
grant select, insert on public.security_events to authenticated;

drop policy if exists "insert own security events" on security_events;
create policy "insert own security events" on security_events
  for insert with check (user_id = auth.uid());

-- Reads restricted to the row owner for now. A real SOC dashboard needs an
-- admin-role policy instead; there is no admin role wired up yet (Phase 4).
drop policy if exists "read own security events" on security_events;
create policy "read own security events" on security_events
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. match_document_chunks — extended to also return trust_level so the
--    Synthesizer's "single most important mechanism" stops being cosmetic.
--    (The 003 version did NOT return trust_level, so every chunk fell back to
--    the 'retrieved' default regardless of its real source.)
-- ---------------------------------------------------------------------------
-- Postgres won't let CREATE OR REPLACE change a function's return columns
-- (the 003 version didn't return trust_level), so the old signature must be
-- dropped first — otherwise replaying migrations 001-005 from scratch fails
-- with "cannot change return type of existing function".
drop function if exists match_document_chunks(vector(384), uuid, int);

create or replace function match_document_chunks(
  query_embedding vector(384),
  match_collection_id uuid,
  match_count int default 5
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  trust_level text,
  similarity float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    document_chunks.chunk_index,
    document_chunks.trust_level,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  join documents on documents.id = document_chunks.document_id
  where documents.collection_id = match_collection_id
    and document_chunks.user_id = auth.uid()
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_document_chunks to authenticated;
