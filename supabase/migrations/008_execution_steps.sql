-- 008_execution_steps.sql: Phase 3a Debug Diary backend.
-- research_sessions already exists (migration 001); we finally start WRITING to it
-- in this phase and add a status column to mirror the Debug Diary's session status.
alter table research_sessions
  add column if not exists status text not null default 'completed';

create table if not exists execution_steps (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references research_sessions(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,  -- denormalized for simple RLS
  step_index  int  not null,
  agent_name  text not null,                 -- 'orchestrator' | 'retriever' | 'synthesizer' | 'critic' | 'reporter' | 'web_scout'
  status      text not null,                 -- 'ok' | 'fallback' | 'error'
  latency_ms  int,
  detail      text,                          -- TRUNCATED summary only, never full content (privacy, BLUEPRINT line 517)
  created_at  timestamptz default now()
);

create index if not exists execution_steps_session_id_idx on execution_steps (session_id);

-- RLS is force-enabled by the ensure_rls trigger the moment this table is created;
-- we enable it explicitly too (idempotent) and MUST supply a policy or it's deny-all.
alter table execution_steps enable row level security;
create policy "own execution steps" on execution_steps using (user_id = auth.uid());

-- Grants are explicit on this project (nothing is auto-exposed, see migration 002).
grant select, insert on public.execution_steps to authenticated;
