# ARGUS — Phase 3: Full Agent Pipeline + Observability

**Status:** 🟡 IN PROGRESS. Sprint 3a.1 is code-complete, pending deploy and live
verification. Sprints 3a.2–3b are still ⏳ not started. Every checkbox is ⏳ until the
sprint that owns it is code-complete (🟡) and then live-verified (✅), per the project's
status-marks rule. This file is the execution plan, not a status claim.
**Timeline:** Weeks 8–10 (blueprint), realistically paced across the sub-sprints below.
**SDLC Stages:** Agent Design → Observability → Adversarial Re-test → Re-deploy
**Prerequisite:** Phase 2 closed and live-verified (✅ 2026-07-07). Confirmed unblocked.

---

## In plain terms (the 30-second version)

Right now ARGUS is a smart-but-literal assistant: you ask, it grabs 5 matching pieces of
your PDF, and answers. It can't handle a vague ask ("summarize this for me"), it never
double-checks itself, and you can't see what it did under the hood.

Phase 3 fixes all three, in five small steps you can ship and test one at a time:

1. **It learns to understand you**. A new "Orchestrator" agent reads what you *mean* and
   rewrites a vague question into focused ones before searching. *(The headline fix. No
   database change. Ships fast.)*
2. **It keeps a diary**. Every research run records who did what, step by step, so you can
   look back later without re-running anything.
3. **It fact-checks itself**. A new "Critic" agent checks the answer against your documents,
   flags weak parts, and retries once if it's unsure (safely capped so it can't loop forever).
4. **It becomes watchable**. Every run streams into a free dashboard (Langfuse) showing
   speed, cost, and the full agent chain.
5. **It remembers**. You can pull up any past session and its diary through the backend
   (the screen that shows it visually comes in Phase 4).

Everything is built so a failure in the diary or the dashboard **never** breaks your actual
answer. Live web search is intentionally held back to **Phase 3b**, after all of the above is
proven working. Each phase in this project opens with a summary like this one.

> **How this phase is structured:** Phase 3 splits into **3a** (the internal multi-agent
> pipeline, Debug Diary, and observability, all on the user's own uploaded PDFs) and **3b**
> (Web Scout / live web search, added only after 3a is verified live). 3a is built and verified
> end-to-end before 3b is touched. Each sub-sprint ends with a live verification gate; a ⏳ does
> not flip to ✅ until its gate has run against the deployed Render + Vercel app and the result is
> recorded in `docs/ADVERSARIAL-TESTS.md`.

## Execution ground rules

The plan is followed strictly. Deviations happen only for a real problem: the code contradicts an
assumption here, a library behaves differently than documented, or a step is genuinely impossible
as written. Cosmetic preference is not a reason to deviate.

A deviation is never a silent improvisation. The problem is stated, a fix proposed, and then
either escalated when it changes scope or architecture, or, when it's a small mechanical
correction, made and recorded in the working log and the relevant ADR in the same turn. Every
deviation leaves a paper trail. That is how this project avoids the doc-vs-code drift it was built
to fight.

Hard boundary: commits, pushes, and anything touching a live platform (Supabase SQL, Render and
Vercel env and deploys) are manual steps, never automated. Each sprint prepares the exact
SQL/env/commands, explains them, and stops there, then waits for the live-verify result before the
next sprint begins.

---

## Context — why this phase exists

Phase 1 built a working 3-agent RAG pipeline (`retriever → synthesizer → reporter`, a fixed
linear LangGraph). Phase 2 hardened it against injection/extraction/poisoning. What's still
missing is the part that makes ARGUS a *research assistant* rather than a single-shot Q&A box,
and the part that makes it demoable as a **DevOps/observability** portfolio piece.

This maps directly onto the blueprint's stated pitch: the "seven questions senior AI engineers
ask in interviews." Phase 3 is the phase that answers most of them: **how you structure
multi-agent systems so agents don't contradict each other** (Orchestrator + Critic), **how you
measure whether RAG actually works** (Critic confidence flags), **what happens when a component
goes down** (breakers + graceful degradation), **how you make behavior observable** (Langfuse),
and **how you debug a 2am failure without re-running anything** (the Debug Diary, which the
blueprint calls "the differentiator feature"). Keeping that vision intact is the point of this plan.

The three concrete gaps:

1. **The pipeline can't reason about a query before answering.** Live testing (July 8, 2026)
   confirmed the headline gap: a vague/meta query like *"summarize for me"* returns *"no
   relevant information found."* Root cause is in `backend/app/agents/retriever.py`. It embeds
   the raw query and pulls the top-5 chunks by cosine similarity with **no intent parsing**, so
   a generic query embeds to a generic vector and retrieves an arbitrary, unrepresentative
   sample. The fix is an **Orchestrator agent** that reads intent and rewrites the query into
   concrete sub-queries before retrieval. This was always the blueprint's design (its Debug
   Diary worked example literally shows `Orchestrator → dispatch plan, 3 refined queries`).

2. **There's no quality check on the answer.** Nothing validates the synthesized draft against
   its sources. A **Critic agent** adds that check and, when it flags low confidence, triggers
   **one bounded re-retrieval loop** (capped. OWASP ASI10, "max 2 loops, no self-modifying
   logic").

3. **There's no observability.** Today the only trace is `print()` to Render's stdout. Phase 3
   adds the **Debug Diary** (a per-agent-step trace persisted to a new `execution_steps` table,
   the backend for the Phase 4 timeline UI) and **Langfuse** (a hosted trace dashboard).

**Intended outcome of Phase 3a:** the same upload → ask flow, but now the system understands
vague queries, self-checks its answer, records every agent step, and every run is traceable in
a real observability dashboard, with all of it degrading gracefully (a down Langfuse or a
crashed step-logger must never break a research session).

**Scope guardrail (the project's #1 rule):** *docs never claim more than the code does.* As
each sprint lands, update `BLUEPRINT.md`, `PHASE3.md` (this file), and `ADVERSARIAL-TESTS.md`
**in the same turn**, and only mark ✅ after a live check.

**Doc security rule (added this session):** never paste an agent's verbatim system prompt into
any doc in this repo (the repo is public). The Synthesizer's prompt contains an explicit
anti-leak clause; printing it in the docs would defeat its own purpose and hand an attacker the
exact text to work around. Describe what a prompt *does* ("frames retrieved content as data, not
instructions"), never the literal prompt string. Verified clean as of this plan. Keep it that way.

---

## Scope decisions locked this session (2026-07-07)

These were chosen deliberately to de-risk an already-large phase. A future session must **not**
silently reopen them:

| Decision | Choice | Why |
|---|---|---|
| Web Scout / live web search | **Deferred to Phase 3b** (built after 3a is live-verified) | Keeps 3a shippable; web text is a new injection channel that deserves its own threat model + gates, not a rushed add-on |
| Observability backend | **Langfuse Cloud (free tier)**: API keys only | Blueprint said "self-hosted," but self-hosting is a whole extra deployed service + hosting bill. Cloud free tier gives the same tracing with zero infra. Documented as ADR-016. |
| Answer quality scoring | **Critic agent flags only; RAGAS deferred** | RAGAS needs heavy deps + several extra LLM calls per query (latency + Groq cost on free tier). The Critic's grounded-ness check delivers the "confidence badge" story now; formal RAGAS metrics are a later add. |
| `execution_steps` ownership | **Denormalized `user_id` column** (not a join to `research_sessions`) | Lets its RLS policy be the same `USING (user_id = auth.uid())` every other table uses: no fragile join-based policy. The `ensure_rls` trigger auto-enables RLS on any new table, so a policy is **mandatory** or the table is deny-all. |
| Tavily circuit breaker | **Ships with the Web Scout agent in Phase 3b** | Reconciles a stale comment in `circuit_breaker.py:3` ("Tavily gets its breaker in Phase 4"): an external-calling agent without a breaker contradicts the whole resilience design. Fix that comment when 3b lands. |
| Build order | **Orchestrator first**, diary/observability after (see sequence) | Ships the visible, vision-defining win (understanding vague queries) first, so there's a demoable improvement before the plumbing. |

---

## Target architecture (before → after)

**Current graph** (`backend/app/agents/graph.py`). Fixed linear, no branching:
```
START → retriever → synthesizer → reporter → END
```

**After Phase 3a**. Orchestrator up front, critic + bounded re-retrieval loop at the back:
```
START → orchestrator → retriever → synthesizer → critic ──(confident OR loop_count≥2)──▶ reporter → END
                          ▲                          │
                          └──────(low confidence)────┘   (loop_count += 1)
```

**After Phase 3b**. Web Scout runs alongside the Retriever, feeding `web_scraped` chunks into
the Synthesizer (its own node + a Tavily breaker; doc-only fallback if Tavily is down).

Every node above is wrapped by the **StepWriter** (records entry/exit to `execution_steps`) and
by **Langfuse** tracing. Both are non-fatal: if either fails, the research call still completes.
The six-agent target (Orchestrator, Retriever, Web Scout, Synthesizer, Critic, Reporter) is the
blueprint's original architecture. Phase 3 finally builds all of it except Web Scout (3b).

---

## State schema changes (`backend/app/agents/state.py`)

`ResearchState` is a `TypedDict`. Phase 3a **adds** these keys (keep all existing ones). Seeding
is incremental. Each sprint seeds the keys it introduces, in the initial state dict in `main.py`
(currently `main.py:285-293`):

| New field | Type | Written by | Introduced in |
|---|---|---|---|
| `intent` | `str` | orchestrator | 3a.1: `'specific'` / `'broad'` / `'meta'`, drives retrieval breadth |
| `refined_queries` | `list[str]` | orchestrator | 3a.1: the sub-queries the retriever runs (the "3 refined queries") |
| `session_id` | `str` | `/research` handler | 3a.2: ties every step + trace to one run; returned to the client |
| `status` | `str` | nodes / handler | 3a.2: `'completed'` / `'completed_with_fallback'` |
| `confidence_flags` | `list[dict]` | critic | 3a.3: per-section grounded-ness flags; feeds the confidence badge |
| `loop_count` | `int` | retriever/critic edge | 3a.3: re-retrieval guard, capped at 2 (ASI10) |
| `web_snippets` | `list[dict]` | web_scout | 3b: `web_scraped`-tagged snippets merged into synthesis |

---

## Database changes

One migration (007), needed starting at Sprint 3a.2. **Platform reminder:** migrations do NOT
auto-run; they are pasted into the Supabase SQL editor by hand. New tables are NOT auto-exposed
(grants are explicit, see migration 002) and RLS is auto-force-enabled by
the `ensure_rls` trigger (see migration 006), so a new table with no policy = deny-all for
everyone including the backend.

### Migration 007 — `execution_steps` table + `research_sessions.status`

```sql
-- 007_execution_steps.sql: Phase 3a Debug Diary backend.
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
```

Notes for the executor:
- `detail` is deliberately a truncated summary (e.g. first ~200 chars, "8 chunks, top score
  0.89", the fallback reason). Full inputs/outputs live in Langfuse. The blueprint's stated
  privacy tradeoff (line 517). Do not dump raw chunk content here.
- No RAGAS/score columns are added to `research_sessions`. RAGAS is deferred, so adding those
  columns now would be the exact "schema claims more than the code does" drift this project
  fights. Add them only in the future phase that actually computes RAGAS.

---

## Phase 3a — sprint breakdown

Build order puts the **visible win first**: the Orchestrator (understanding vague queries) ships
before the diary/observability plumbing, so there's a demoable improvement early. Each sprint is
independently deployable and verifiable. After you live-test each one, jot anything you notice in
**Field notes** (bottom of this doc). That's how your testing concerns stack across the build.

### Sprint 3a.1 — Orchestrator agent + intent-based retrieval (the headline win)

**Status:** 🟡 Code-complete, partially live-verified. The vague-query failure (blank answers on
queries like "summarize for me") was traced to neither retrieval nor classification, both
confirmed working against live data. The synthesis model is a reasoning model whose token budget
covers its internal reasoning *and* the visible answer together; when reasoning ran long it
consumed the whole budget and returned nothing. Capping reasoning effort on both model calls fixed
it, with a guard so an empty completion can never surface as a silent blank answer. This also
settled an open model-choice question: the model was never the weak point, the budget was. This
fix, at `reasoning_effort: "low"` on both the Orchestrator and Synthesizer, was live-tested
2026-07-08 and passed: the pinned acceptance criterion (vague query returns a real answer, not a
refusal) holds.

**Since that passing test, one more change has been made and is NOT yet live-verified:** the
Orchestrator's `reasoning_effort` was raised from `"low"` to `"medium"` (synthesizer unchanged) to
give intent classification more room on terse/atypical phrasing, like a bare `"summarize"` with no
punctuation and nothing matching the system prompt's few-shot examples. This reopens some of the
reasoning-length variability the original fix was capping, so `max_tokens` was raised 512→768 to
compensate. Worst case if it still overruns: the Orchestrator's existing fail-open logic (any
parse failure falls back to a raw-query pass) absorbs it; this cannot reproduce the Synthesizer's
blank-answer bug. Still needs a fresh live pass on both a normal query and a terse one before this
sprint can close.
**Do not flip to ✅ until this specific version is re-verified live.**
Concrete constants chosen: `SPECIFIC_MATCH_COUNT=5`, `BROAD_MATCH_COUNT=8` (per sub-query),
`FINAL_TOP_N=8` after merge/dedupe/sort by similarity. Picked so the single-query "specific"
path returns byte-for-byte the same rows Phase 2 did (no regression), while "broad"/"meta" fan
out across up to 3 sub-queries before capping. New file: `backend/app/agents/orchestrator.py`.
Changed: `retriever.py`, `graph.py`, `state.py`, `main.py`'s `/research` seed dict.

**In plain terms:** teach ARGUS to understand what you *mean*. A vague "summarize for me" gets
rewritten into a few focused questions before it searches, so it returns a representative slice
of your document instead of a random five chunks. Ships with **no database change**.

**Concept:** The Orchestrator is a new first agent. It reads the raw query and uses Groq to
decide *what kind* of question it is and to rewrite it into concrete sub-queries the retriever
can actually match. **This is the pinned Phase 3 acceptance criterion** (`BACKLOG.md` Item 1).

**Build:**
- `backend/app/agents/orchestrator.py` (new). `async def orchestrator_node(state) -> dict`.
  Calls Groq (through `groq_breaker.call(...)`, reusing the existing breaker) with a prompt that
  returns JSON: `{"intent": "specific|broad|meta", "refined_queries": [...]}`. **Fail-open:** if
  Groq is down/open or returns junk, fall back to `intent='specific'`,
  `refined_queries=[state["query"]]` so the pipeline still runs (the Orchestrator improving
  retrieval must never *block* retrieval). Reuse the `AsyncGroq` client pattern and model
  (`openai/gpt-oss-20b`) already used in `synthesizer.py`.
- `backend/app/agents/retriever.py`. Change from one raw-query embed to: embed **each** of
  `state["refined_queries"]`, call `match_document_chunks` per sub-query, **merge + dedupe by
  chunk `id`**, keep the top-N by `similarity`. For `intent='broad'/'meta'`, pass a larger
  `match_count` (e.g. 8) per sub-query to widen the sample. This implements the blueprint's
  "3 refined queries" behavior.
  - **No RPC signature change is required**. `match_document_chunks` already accepts
    `match_count` as a parameter, so widening is a Python-side change. (Adding a
    similarity-threshold arg to the RPC is explicitly **out of scope** here; the sub-query merge
    solves the acceptance criterion without a schema migration. Note it as deferred, don't build it.)
- `graph.py`. Add `orchestrator` node, rewire `START → orchestrator → retriever`. (Tracing gets
  wrapped on in 3a.2 once the StepWriter exists, not needed for this sprint to work.)
- Seed `intent` / `refined_queries` in the initial state dict in `main.py`.

**Manual step (Clint):** git push → Render redeploy. **No migration.**

**Verify live (the acceptance gate):**
- The pinned criterion: send `"summarize for me"` (and `"what's the gist"`) against a real
  collection. Must return a **real answer**, not "no relevant information found." Record the
  result and close the `BACKLOG.md` Item 1 row.
- Regression: a specific query (e.g. "What was Q3 revenue?") still returns the same focused
  answer it did in Phase 2 (no quality regression from the merge).
- Fail-open check: with `GROQ_API_KEY` invalidated, the Orchestrator falls back to the raw query
  and retrieval still returns chunks (only synthesis shows the graceful banner).
- → Log any concerns in **Field notes**.

---

### Sprint 3a.2 — Session backbone + StepWriter (the Debug Diary)

**In plain terms:** give ARGUS a memory and a diary. It now saves each research run and writes
down what every agent did, step by step, so you can look back later without re-running anything.
Built so the diary failing can never break your answer.

**Concept:** "Memory" = write one `research_sessions` row per query (the table exists but has
never been written to). "Diary" = a `StepWriter` that logs one `execution_steps` row per agent as
it runs. This sprint also retro-wraps the agents built so far with tracing.

**Build:**
- Run **migration 007** (manual step, detailed below).
- `backend/app/services/step_writer.py` (new):
  - `async def record_step(session_id, user_id, access_token, step_index, agent_name, status, latency_ms, detail)`, POSTs one row to `execution_steps` via the existing `supabase_request` (`supabase_client.py`). **Must never raise:** wrap the whole body in `try/except` and on failure `print()` to stdout (local-log fallback), the blueprint is explicit that the diary failing must never crash a research session.
  - `def traced(agent_name)`. An async decorator that wraps a LangGraph node: records `time.monotonic()` at entry, runs the node, computes `latency_ms`, calls `record_step(...)`, returns the node's dict unchanged. Comment why: a decorator avoids copy-pasting timing code into every node.
- `graph.py`. Apply `@traced("...")` to **all** nodes now present (`orchestrator`, `retriever`,
  `synthesizer`, `reporter`).
- `backend/main.py` `/research` handler. Before invoking the graph: (1) insert a
  `research_sessions` row (`user_id`, `collection_id`, `query`), capture its `id`; (2) put
  `session_id` into the initial state; (3) after the graph returns, `PATCH` the session row with
  `report` + final `status`; (4) return `session_id` in the response JSON (additive. Existing
  `report`/`chunks_used` stay). Seed `session_id` / `status` in the state dict.

**Reuse, don't rebuild:** `supabase_request` for all writes.

**Manual step (Clint):** paste migration 007 into the Supabase SQL editor; confirm
`execution_steps` exists with one `"own execution steps"` policy. Then git push → Render redeploy.

**Verify live:**
- Run a normal query → one `research_sessions` row + four `execution_steps` rows
  (orchestrator/retriever/synthesizer/reporter), RLS-scoped to your user, sane `latency_ms`.
- **StepWriter-never-crashes test:** temporarily point `record_step` at a bad table name (or
  simulate a Supabase failure) and confirm the query STILL returns a report (diary fails
  silently, session survives). This is the blueprint's chaos requirement. Record in
  `ADVERSARIAL-TESTS.md`.
- → Log any concerns in **Field notes**.

---

### Sprint 3a.3 — Critic agent + bounded re-retrieval loop

**In plain terms:** ARGUS learns to check its own homework. A new Critic agent compares the
answer to your documents, flags anything not backed by a source, and if it's unsure, tries once
more, with a hard stop so it can never loop forever.

**Concept:** The Critic runs *after* the Synthesizer. It checks whether the draft is supported by
the retrieved chunks (grounded-ness) and flags weak sections. Low confidence → the graph loops
back to the Retriever **once**, hard-capped at 2 iterations (OWASP ASI10).

**Build:**
- `backend/app/agents/critic.py` (new). `async def critic_node(state) -> dict`. Groq call
  (through `groq_breaker`) comparing `state["answer"]` against `state["chunks"]`, returns
  `confidence_flags` (list of `{section, grounded, note}`) plus `needs_retry: bool`.
  **Fail-open:** on Groq failure, empty flags + `needs_retry=False` (a broken critic must not
  block the report).
- `graph.py`. Insert `critic` after `synthesizer`; add a **conditional edge**:
  ```python
  def route_after_critic(state) -> str:
      if state.get("needs_retry") and state["loop_count"] < 2:
          return "retry"
      return "done"
  builder.add_conditional_edges("critic", route_after_critic,
                                {"retry": "retriever", "done": "reporter"})
  ```
  On `retry`, increment `loop_count` and set `status='completed_with_fallback'`. This is the
  graph's **first cycle**. Double-check the guard is bulletproof. Wrap `critic` with `@traced`.
- `backend/app/agents/reporter.py`. Append a **confidence badge** to the markdown report based
  on `confidence_flags` (e.g. "⚠️ Low-confidence section" or a "Confidence: high" footer). Keep
  it pure string formatting (no LLM), as the reporter is today. This satisfies the blueprint's
  ASI09 close (confidence rendered on the report, not buried in metadata).
- Seed `confidence_flags` / `loop_count` in the state dict.

**Manual step (Clint):** git push → Render redeploy.

**Verify live:**
- Ask something the collection can't fully answer → Critic flags low confidence, the loop fires
  once, the diary shows the retriever running twice and `status=completed_with_fallback`, the
  report carries the badge.
- **Loop-cap test (ASI10):** force `needs_retry=True` and confirm the graph stops after exactly
  2 retrieval passes, no infinite loop, no hang. Security-relevant gate; record in
  `ADVERSARIAL-TESTS.md`.
- A well-answered query shows `Confidence: high` and does NOT loop.
- → Log any concerns in **Field notes**.

---

### Sprint 3a.4 — Langfuse Cloud observability

**In plain terms:** plug in a free dashboard that shows every run. How long each agent took,
how many tokens it used, where it failed. If the dashboard is down, your answers keep working.

**Concept:** Langfuse (free cloud tier, API keys only) records every LLM/agent call. The Debug
Diary is the quick in-app triage layer; Langfuse is the deep-dive layer. Must be **non-fatal**.

**Build:**
- `pip` add `langfuse` (pinned) to `backend/requirements.txt`.
- Env vars in `backend/.env.example`: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `LANGFUSE_HOST` (e.g. `https://cloud.langfuse.com`).
- `backend/app/services/observability.py` (new). Init the Langfuse client from env; emit a
  trace keyed by `session_id` and a span per agent step (hook it into the `traced(...)` decorator
  so diary + Langfuse happen in one place). Guard every Langfuse network call with a new
  **`langfuse_breaker`** (add to `circuit_breaker.py` next to `groq_breaker`/`hf_breaker`;
  BLUEPRINT thresholds. 5 fails / 5 min / 300 s). Breaker open or SDK error → no-op + `print()`.
- Update `/health/circuit-breakers` (`main.py:60-64`) to report **all** breakers (`groq`, `hf`,
  `langfuse`). It currently only returns `groq` (a small honesty fix: it hides two of them).

**Manual step (Clint):** (1) create a free Langfuse Cloud account + project, copy the public +
secret keys; (2) set `LANGFUSE_*` in Render's backend env; (3) git push → Render redeploy.

**Verify live:**
- Run a query → a trace with per-agent spans appears in Langfuse.
- **Langfuse-down test:** set an invalid Langfuse key, run a query, confirm it STILL returns a
  report (breaker trips → no-op) and `/health/circuit-breakers` shows the `langfuse` state.
  Record in `ADVERSARIAL-TESTS.md`. Restore the key after.
- → Log any concerns in **Field notes**.

---

### Sprint 3a.5 — Session read endpoints (Debug Diary API surface)

**In plain terms:** add the backend "windows" to pull up a past research session and its diary.
The visual timeline that displays them is Phase 4. This sprint just makes the data fetchable.

**Concept:** The Phase 4 UI needs to fetch a past session + its steps. Phase 3 builds the
**backend** (blueprint API surface: `/research/{id}`, `/research/{id}/trace`); the timeline UI is
Phase 4, not now.

**Build:**
- `backend/main.py`. Two authenticated GETs:
  - `GET /research/{id}` → the `research_sessions` row (RLS-scoped via the user's token) +
    report/status. 404 if not owned/found (reuse the ownership pattern in the existing `/research`
    collection check).
  - `GET /research/{id}/trace` → the ordered `execution_steps` rows for that session.
- No frontend timeline work here. The `/research` response already includes `session_id`
  (backward-compatible from 3a.2); the frontend can ignore it until Phase 4.

**Manual step (Clint):** git push → Render redeploy.

**Verify live:** call both endpoints with your token for a real session id → correct data; call
with someone else's session id (or a random uuid) → clean 404, no leak. → Log any concerns in
**Field notes**.

---

## Phase 3b — Web Scout (live web search) — OUTLINE ONLY

**In plain terms:** let ARGUS also pull fresh answers from the live web, not just your PDFs.
Added only once everything above is proven working, because untrusted web text is a new place
attackers can hide instructions.

Build this **only after 3a is fully live-verified.** Full sprint detail + a dedicated injection
threat model get written when 3b is picked up (own ADR). Sketch:

- **New agent** `backend/app/agents/web_scout.py`. Calls **Tavily** for real-time snippets, tags
  them `trust_level='web_scraped'`, runs them through the **same** injection guard/shadow scan as
  document chunks (web text is untrusted; the Synthesizer already frames `web_scraped` as data,
  but that assumption still needs verifying).
- **New breaker** `tavily_breaker` in `circuit_breaker.py` (5 fails / 2 min / 60 s → doc-only
  fallback). **Fix the stale comment** at `circuit_breaker.py:3` assigning Tavily's breaker to
  Phase 4.
- **Graph**. Web Scout alongside the Retriever, both feeding the Synthesizer; Tavily down →
  proceed doc-only with a banner.
- **Env**. Add `TAVILY_API_KEY` to `.env.example` + Render.
- **New adversarial gates** (GATE-14+). Injection via a web result must be neutralized exactly
  like a poisoned chunk; a Tavily outage must degrade, not 500.

---

## Manual platform steps (prepare, explain, stop)

Everything touching live systems is a manual step. Consolidated:

1. **Migration 007:** paste into the Supabase SQL editor by hand; verify `execution_steps` exists
   with its RLS policy and grants. (Sprint 3a.2)
2. **Langfuse Cloud:** create account and project, copy keys, set `LANGFUSE_*` env on Render.
   (Sprint 3a.4)
3. **Tavily:** create account, set `TAVILY_API_KEY` on Render. (Phase 3b only)
4. **Deploys:** every sprint ends with a git push (commits and pushes are always manual); Render
   and Vercel rebuild on push. "Deployed" means the live URLs were re-checked. Render free tier:
   first hit after idle is 30–60 s, not a bug.

---

## Acceptance criteria — what "Phase 3a done" means

Phase 3a closes only when every item below has been run against the **live** deployed app and
recorded (pass or fail) in `docs/ADVERSARIAL-TESTS.md`:

1. **Vague-query fix (the pinned one):** `"summarize for me"` returns a real, representative
   answer, not a "no information" refusal. (`BACKLOG.md` Item 1 closes with Sprint 3a.1.)
2. **Debug Diary:** every run writes a `research_sessions` row + ordered `execution_steps` rows;
   the diary is RLS-scoped and the StepWriter never crashes a session even when its write fails.
3. **Critic + bounded loop:** low-confidence answers trigger at most one re-retrieval; the loop
   is hard-capped at 2 (ASI10) with no hang; the report shows a confidence badge.
4. **Observability:** per-agent traces appear in Langfuse; with Langfuse down, research still
   completes (breaker), and `/health/circuit-breakers` reports all breakers.
5. **Read API:** `/research/{id}` and `/research/{id}/trace` return correct, ownership-scoped
   data; someone else's session id → clean 404.
6. **No regression:** Phase 1/2 flows still pass. Specific queries answer as before, and all 13
   Phase 2 gates still hold (spot-check the injection gates, since new agents added Groq call sites).

---

## Field notes from testing (Clint) — stacks after every sprint

**This is your running log.** As you live-test each sprint you'll spot things. A rough edge, a
"wouldn't it be better if…", a bug, an idea for a later phase. Write them here as you go. They
**accumulate across the whole build** (nothing gets dropped between phases): at each sprint/phase
close, the executing session reviews this list, actions anything in-scope, and graduates
still-open cross-phase items into `docs/BACKLOG.md` so they survive to the phase that owns them.
Every phase doc from here on carries a section like this.

Format: `Date | Sprint | What I noticed | Useful for (this phase / future / bug) | Status`.
Example of the kind of entry to write: `2026-07-XX | 3a.1 | "summarize" works but answers feel
generic on very large PDFs | future (retrieval tuning) | open`.

| Date | Sprint / Phase | What I noticed | Useful for | Status |
|---|---|---|---|---|
| 2026-07-07 | 3a.1 | Vague queries returned blank answers. Ruled out retrieval and classification against live data (both fine); real cause was the synthesis model's token budget being shared between internal reasoning and output, so long reasoning left nothing for the answer. Fixed by capping reasoning effort. | headline win | fixed, verified live 2026-07-08 |
| 2026-07-07 | 3a.1 | Design lesson: any reasoning-model call needs an explicit reasoning/output budget or it can silently return empty: carry this into the Critic and Web Scout agents. | future (all model calls) | open |
| 2026-07-08 | 3a.1 | A bare "summarize" (no punctuation, not matching the system prompt's few-shot wording) is the kind of terse/lazy phrasing real users send, and low reasoning effort may not judge it as reliably as clearer phrasing. Raised the Orchestrator's `reasoning_effort` low to medium, `max_tokens` 512 to 768 to compensate. Synthesizer untouched (different job, not classification). | this sprint, intent-recognition robustness | implemented, not yet live-tested |
| 2026-07-08 | 3a.1 | Heisenbug: bare "summarize" sometimes returns "No relevant information found" while "summarize " (trailing space) or a retry answers. Code trace showed that message only fires when the retriever returns zero chunks, but the live RPC has no similarity threshold, so a valid embedding against a populated collection always returns rows. The empty is only reachable via a broken embedding (HF cold-start returning a wrong shape) or an un-captured Orchestrator output. The trailing space is almost certainly non-determinism (warm HF endpoint / clean classification on retry), not a real cause. Hardened rather than guessed: normalized the query (strip) at the entry point so whitespace can't change the answer; added retriever logging of embedding dim + rows-per-sub-query; made `embed_query` validate a 384-float vector and raise loudly instead of passing an error dict / wrong shape through silently. | this sprint, plus a reusable observability + fail-loud lesson for every embedding/model call | diagnosable + whitespace-hardened; ROOT CAUSE still open, needs the Render `orchestrator intent=...` + retriever log line from the *next* failing run |
|  |  |  |  |  |

---

## ADRs to write (as decisions are made, not retroactively)

- **ADR-014. Orchestrator intent routing via sub-query expansion** (why sub-query merge over an
  RPC threshold change; the fail-open stance).
- **ADR-015. Bounded re-retrieval loop + Critic** (the ASI10 cap; why the graph's first cycle is
  safe).
- **ADR-016. Langfuse Cloud over self-hosted** (records the scope decision above and its tradeoff
  vs. the blueprint's "self-hosted" wording).
- **(3b) ADR-017. Web Scout + web-content injection handling** (the new untrusted channel).

## Docs to keep in sync (same turn as the code)

- **This file:** flip ⏳ → 🟡 → ✅ per sprint as it lands and verifies; keep the "In plain terms"
  summary accurate.
- **`BLUEPRINT.md`:** Phase 3 roadmap line, the six-agent table (agents move from planned to
  built), the `execution_steps`/`research_sessions` data-layer rows, OWASP map (LLM09/ASI09/ASI10).
- **`PHASE2.md`:** its "Known Limitations" rows (Orchestrator/Critic/Langfuse/Debug Diary leave
  "missing").
- **`BACKLOG.md`:** Item 1 (query intent) closes when Sprint 3a.1 verifies; new Field-notes items
  graduate here.
- **`ADVERSARIAL-TESTS.md`:** new gates for the StepWriter chaos test, the loop cap, the
  Langfuse-down degradation, and the 3b web-injection gates.

Reminder: **never** paste an agent's verbatim system prompt into any of these.

---

## Suggested build sequence (locked this session)

3a.1 (Orchestrator, the visible win) → 3a.2 (session backbone + Debug Diary) → 3a.3 (Critic +
bounded loop) → 3a.4 (Langfuse) → 3a.5 (read endpoints). Verify each live before the next. Only
after all of 3a is verified, start 3b (Web Scout).
