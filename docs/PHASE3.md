# ARGUS — Phase 3: Full Agent Pipeline + Observability

**Status:** 🟡 IN PROGRESS. Sprint 3a.1 (Orchestrator + intent retrieval) is ✅ complete and
live-verified (2026-07-08). Sprint 3a.2 (Debug Diary + meta lead-chunk retrieval fix), the
document management fix, and Sprint 3a.5 (session read endpoints) are all ✅ live-verified
(2026-07-08) — see the field notes. Sprint 3a.3 (Critic + bounded re-retrieval loop) has its
security-critical loop-cap mechanism ✅ verified live, with the happy-path check (step 6) and a
confidence-badge wording nuance still open — see TC-3a.3-01. Sprint 3a.4 (Langfuse) is still 🟡:
code is written but not yet deployed (none of this session's changes have been pushed), so traces
can't be checked until after a push. Phase 3b is still ⏳ not started. Every checkbox is ⏳ until the sprint that owns it is
code-complete (🟡) and then live-verified (✅), per the project's status-marks rule. This file is
the execution plan, not a status claim.
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
| `step_index` | `int` | `traced()` decorator | 3a.2: continuous step counter across the whole run, including a retry loop |
| `confidence_flags` | `list[dict]` | critic | 3a.3: per-section grounded-ness flags; feeds the confidence badge |
| `needs_retry` | `bool` | critic | 3a.3: True only when confidence is low AND the critic supplied novel gap queries |
| `loop_count` | `int` | critic | 3a.3: incremented inside the critic node itself each pass; re-retrieval guard, capped at 2 (ASI10) |
| `web_snippets` | `list[dict]` | web_scout | 3b: `web_scraped`-tagged snippets merged into synthesis |

Note: `research_sessions.status` (`'completed'` / `'completed_with_fallback'` / `'error'`) is
**not** a `ResearchState` field — the `/research` handler derives it from `loop_count` after
`ainvoke` returns (`loop_count >= 2` means the critic ran twice, which only happens after a retry
fired), so there's no extra state plumbing for it.

---

## Database changes

Two migrations. **007** (`hnsw_vector_index`) ships with Sprint 3a.1 — it replaces the ivfflat
ANN index with HNSW to fix the vague-query zero-recall bug (see the field notes and the file's
own header comment). **008** (`execution_steps`) is needed starting at Sprint 3a.2.
**Platform reminder:** migrations do NOT auto-run; they are pasted into the Supabase SQL editor
by hand. New tables are NOT auto-exposed (grants are explicit, see migration 002) and RLS is
auto-force-enabled by the `ensure_rls` trigger (see migration 006), so a new table with no
policy = deny-all for everyone including the backend.

### Migration 008 — `execution_steps` table + `research_sessions.status`

```sql
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

**Status:** ✅ Complete, live-verified 2026-07-08. The pinned acceptance criterion holds on the
deployed app: a vague query ("summarize", "summary", "summarize for me") returns a real,
representative answer instead of a refusal. Getting here took fixing three separate things, each
found by live testing and traced before being touched:

1. **Blank-answer bug (token budget).** The synthesis model is a reasoning model whose token
   budget covers its internal reasoning *and* the visible answer together; when reasoning ran long
   it consumed the whole budget and returned nothing. Capping reasoning effort on both model calls
   fixed it, with a guard so an empty completion can never surface as a silent blank answer.
2. **Terse-input classification.** The Orchestrator's `reasoning_effort` was raised `"low"` →
   `"medium"` (Synthesizer unchanged) so bare inputs like `"summarize"`, with no punctuation and no
   few-shot match, are judged reliably; `max_tokens` 512 → 768 to absorb the added reasoning
   variance. The existing fail-open path (parse failure → raw-query pass) bounds the worst case.
3. **Zero-chunks bug (vector index recall).** Some valid queries returned *zero* chunks. Retriever
   instrumentation traced it to the **ivfflat index** (`lists = 100`, migration 001) losing recall
   on a small dataset at the default `probes = 1`. Migration `007_hnsw_vector_index.sql` replaces
   it with HNSW. Applied live and re-tested; retrieval now reliably returns nearest chunks.

Two minor, non-blocking items were logged to the field notes rather than fixed: the injection
classifier false-positives on the OOD token `tldr` (a known ML limitation, deliberately not
weakened for one niche word), and meta-summaries can miss header facts like an author's name
(expected top-N RAG behavior; a "always include chunk 0 for meta intent" enhancement is filed).
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

### Sprint 3a.2 — Session backbone + StepWriter (the Debug Diary) + a retrieval fix

**Status:** ✅ Live-verified 2026-07-08. `docs/PHASE3-TEST-SCRIPT.md` steps 1–3 all passed:
baseline diary (real answer + `## Sources` + `## Confidence`), the meta lead-chunk fix
(`"summarize this for me"` now includes the identifying header info), and the TC-3a.2-01 chaos
test (diary write failures degrade gracefully — confirmed live via Render logs, see
`ADVERSARIAL-TESTS.md`).

**In plain terms:** give ARGUS a memory and a diary. It now saves each research run and writes
down what every agent did, step by step, so you can look back later without re-running anything.
Built so the diary failing can never break your answer. Bundled alongside: the small retrieval fix
from 3a.1's field notes (below) — a "summarize" of a resume now includes the person's name.

**Concept:** "Memory" = write one `research_sessions` row per query (the table exists but has
never been written to). "Diary" = a `StepWriter` that logs one `execution_steps` row per agent as
it runs. This sprint also retro-wraps the agents built so far with tracing.

**Build (retrieval fix, `retriever.py` only):** for `intent == "meta"`, fetch each document's
`chunk_index=0` (its opening chunk — title/author/intro), dedupe against the vector-match ids
already retrieved, cap at 3, and prepend them so the top-N cap can't drop them. `specific`/`broad`
retrieval is untouched — they already have a real topic, so semantic search is on-target.

**Build (Debug Diary):**
- Run **migration 008** (manual step, detailed below).
- `backend/app/services/step_writer.py` (new):
  - `async def record_step(session_id, user_id, access_token, step_index, agent_name, status, latency_ms, detail)`, POSTs one row to `execution_steps` via the existing `supabase_request` (`supabase_client.py`). **Must never raise:** wrap the whole body in `try/except` and on failure `print()` to stdout (local-log fallback), the blueprint is explicit that the diary failing must never crash a research session.
  - `def traced(agent_name)`. An async decorator that wraps a LangGraph node: records `time.monotonic()` at entry, runs the node inside its own try/except (on exception, records a `status="error"` step then re-raises so the original failure still propagates), computes `latency_ms`, pops optional `trace_detail`/`trace_status` off the node's returned dict (default `None`/`"ok"`) so per-node context reaches the diary without touching `ResearchState`, calls `record_step(...)`, increments `step_index`, returns the result. Comment why: a decorator avoids copy-pasting timing code into every node.
- `graph.py`. Apply `traced("...")(...)` to **all** nodes now present (`orchestrator`, `retriever`,
  `synthesizer`, `reporter`).
- `backend/main.py` `/research` handler. Before invoking the graph: (1) insert a
  `research_sessions` row (`user_id`, `collection_id`, `query`, `status="running"`), capture its
  `id` — best-effort: if the insert itself fails, `session_id` stays `None` and the diary quietly
  no-ops for that run instead of blocking the query; (2) seed `session_id` / `step_index: 0` into
  the initial state; (3) after the graph returns, `PATCH` the session row with `report` +
  `status="completed"` (on an `ainvoke` exception, `PATCH` `status="error"` first, then re-raise);
  both patches are themselves try/except-guarded so a diary write failure never masks the real
  error or blocks a good answer; (4) return `session_id` in the response JSON (additive — existing
  `report`/`chunks_used` stay).

**Reuse, don't rebuild:** `supabase_request` for all writes.

**Manual step (Clint):** paste migration 008 into the Supabase SQL editor; confirm
`execution_steps` exists with one `"own execution steps"` policy. Then git push → Render redeploy.

**Verified live 2026-07-08:** `docs/PHASE3-TEST-SCRIPT.md` steps 1–3 (baseline diary, meta
lead-chunk check, TC-3a.2-01 chaos test) all passed. See **Field notes**.

---

### Sprint 3a.3 — Critic agent + bounded re-retrieval loop

**Status:** 🟡 Loop-cap mechanism live-verified 2026-07-08 (see TC-3a.3-01 in
`ADVERSARIAL-TESTS.md`: retry fired, capped at exactly 2 passes, no hang — with an open,
non-blocking field note on badge-wording consistency across passes). Step 6's happy-path check
(single pass, no retry) not yet separately run — that's what's still holding this at 🟡.

**In plain terms:** ARGUS learns to check its own homework. A new Critic agent compares the
answer to your documents, flags anything not backed by a source, and if it's unsure, tries once
more, with a hard stop so it can never loop forever.

**Concept:** The Critic runs *after* the Synthesizer. It checks whether the draft is supported by
the retrieved chunks (grounded-ness) and flags weak sections. Low confidence → the graph loops
back to the Retriever **once**, hard-capped at 2 iterations (OWASP ASI10).

**Built (2026-07-08):**
- `backend/app/services/llm_json.py` (new). The JSON-extraction helper (markdown-fence
  stripping, `{...}` fallback) moved out of `orchestrator.py` — both the Orchestrator and the
  Critic parse the same Groq JSON-in-text shape, so it's shared instead of duplicated.
- `backend/app/agents/critic.py` (new). `async def critic_node(state) -> dict`. Groq call
  (through `groq_breaker`, `reasoning_effort="medium"`, `max_tokens=1536` — same reasoning-model
  budget lesson as the Orchestrator/Synthesizer) comparing `state["answer"]` against
  `state["chunks"]`, returns `confidence_flags` (list of `{section, grounded, note}`, always ≥1
  entry on success) plus `needs_retry: bool`. **Fail-open:** on any failure (Groq down, breaker
  open, bad JSON), empty flags + `needs_retry=False` — a broken critic must not block the report.
  **`loop_count` is incremented inside this node** (`state.get("loop_count", 0) + 1`), not by the
  graph edge, so it's already part of state by the time the router below runs, and a missed seed
  can never cause a loop.
  - **Retry is only meaningful, not automatic.** Re-running the retriever with identical
    `refined_queries` returns identical chunks, so `needs_retry` is only `True` when the Critic's
    JSON also supplies 1-2 novel gap-targeted `retry_queries` — the Critic tells the Retriever
    what was missing, so the second search pass looks for exactly that. Those queries get
    appended to `refined_queries` (capped at 5 total) for the retry pass.
- `graph.py`. Inserted `critic` after `synthesizer`; conditional edge:
  ```python
  def route_after_critic(state) -> str:
      if state.get("needs_retry") and state.get("loop_count", 0) < 2:
          return "retry"
      return "done"
  builder.add_conditional_edges("critic", route_after_critic,
                                {"retry": "retriever", "done": "reporter"})
  ```
  This is the graph's **first cycle**. On a retry, the diary shows retriever/synthesizer/critic
  running **twice** with a continuous `step_index` (0-7 total, orchestrator through reporter) —
  that's the intended, visible record of the self-check loop firing, not a bug. Wrapped `critic`
  with `traced("critic")` like every other node.
- `backend/app/agents/reporter.py`. Pure string formatting, no LLM: `flags == []` (Critic skipped
  or failed open) renders "Not assessed", ungrounded flags render a `⚠️ Low` badge with notes,
  otherwise `High`. Rendering "High" when the Critic never actually ran would overclaim
  confidence that was never checked — hence the three-way split instead of defaulting to High.
- `backend/main.py`. Seeded `confidence_flags: []`, `needs_retry: False`, `loop_count: 0` in the
  initial state dict. After `ainvoke`, `final_status = "completed_with_fallback" if
  result.get("loop_count", 0) >= 2 else "completed"` — `status` was never added as a
  `ResearchState` field (see the state table above); the handler derives it from `loop_count`,
  which is simpler and avoids a field two different layers would need to keep in sync.

**Manual step (Clint):** git push → Render redeploy. No migration —
`research_sessions.status` is unconstrained text (migration 008), so
`'completed_with_fallback'` just works.

**Verify live:** see `docs/PHASE3-TEST-SCRIPT.md` steps 6–7 (Critic happy path, forced retry +
loop-cap check). → Log any concerns in **Field notes**.

---

### Sprint 3a.4 — Langfuse Cloud observability

**In plain terms:** plug in a free dashboard that shows every run. How long each agent took,
how many tokens it used, where it failed. If the dashboard is down, your answers keep working.

**Concept:** Langfuse (free cloud tier, API keys only) records every LLM/agent call. The Debug
Diary is the quick in-app triage layer; Langfuse is the deep-dive layer. Must be **non-fatal**.

**Built (2026-07-08, revised 2026-07-09) — deviates from the original sketch above, see
ADR-016:** the original plan called for a `langfuse_breaker`. Not built, on both passes. Under
OpenTelemetry (the foundation of Langfuse's current SDK), span export runs on a background
thread — the calls made from `step_writer.py` never do network I/O on the request path, and
delivery failures never propagate back to the caller. A circuit breaker would guard a call that
cannot fail in the way breakers guard against; it would be dead code pretending to protect
something. Verified directly, not just asserted: a smoke test built a real client with
syntactically-valid but fake keys, created spans, and let the background exporter's delivery
attempt fail with a real `401 Unauthorized` — nothing in the process raised or noticed.

**Revised 2026-07-09** after installing Langfuse's official Claude Code skill
(`github.com/langfuse/skills`) and following its documentation-first workflow: the initial build
(2026-07-08) pinned SDK v2 to dodge v3+'s OpenTelemetry dependency tree, an assumption never
actually measured. A real measurement (clean-venv import RSS comparison) found v4's marginal cost
over v2 is ~4MB — negligible next to `langgraph`'s own ~100MB already accepted on this instance —
so the project moved to the current SDK. Full numbers and reasoning in ADR-016 (revised).

- `backend/requirements.txt`: `langfuse==4.13.1` (current latest) + `openinference-
  instrumentation-groq==0.1.16` (auto-captures model name + token usage on every Groq call,
  process-wide, zero changes to orchestrator.py/synthesizer.py/critic.py).
- Root `.env.example`: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` (renamed
  from `LANGFUSE_HOST` — the v4 SDK's current env var name). All optional — absent keys cleanly
  disable Langfuse (one startup log line), research is unaffected either way.
- `backend/app/services/observability.py` (rewritten). `traced_span(agent_name, session_id,
  user_id)` is a context manager, not a post-hoc emit call — the wrapped node runs INSIDE the
  Langfuse span so any Groq call it makes nests under that span automatically via
  GroqInstrumentor. `session_id` doubles as the OTel trace id (dashes stripped -> exactly 32 hex
  chars), so one research run's whole trace needs no second id. `mask_otel_spans` truncates any
  span attribute over 300 chars before export, as defense in depth (matches
  `execution_steps.detail`'s own truncation convention). **Deliberately manual instrumentation,
  not the LangChain/LangGraph CallbackHandler** Langfuse generally recommends — the
  CallbackHandler auto-captures each node's FULL state (every chunk, the full answer) as span
  data, which would send far more to a third-party cloud service than this project's privacy
  stance (ADR-013) and the Debug Diary's own truncated-detail rule allow. Manual spans send
  exactly what `step_writer.py` already decided to send. Full reasoning in ADR-016.
- `backend/app/services/step_writer.py`. `traced()`'s wrapper now runs the node INSIDE
  `traced_span(...)` (`with traced_span(...) as span: result = await node_fn(state)`) instead of
  tracing it after the fact — required for the Groq-call nesting above. `mark_span(span, status,
  detail)` records the same `trace_detail`/`trace_status` the Postgres diary gets, right before
  the span closes.
- `/health/circuit-breakers` reports all three: `groq`, `hf_prompt_guard` (previously hidden),
  and `langfuse` (the enabled/disabled flag, not a breaker state).

**Manual step (Clint):** (1) create a free Langfuse Cloud account + project, copy the public +
secret keys; (2) set `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL` in Render's
backend env — **if you already set `LANGFUSE_HOST` from an earlier version of this sprint, rename
it to `LANGFUSE_BASE_URL`, same value** (this is a real breaking rename, not cosmetic — the old
key name is silently ignored by the new code); (3) git push → Render redeploy.

**Verify live:** see `docs/PHASE3-TEST-SCRIPT.md` steps 9–10 (trace appears, Langfuse-down
degradation). → Log any concerns in **Field notes**.

---

### Sprint 3a.5 — Session read endpoints (Debug Diary API surface)

**Status:** ✅ Live-verified 2026-07-08. `docs/PHASE3-TEST-SCRIPT.md` step 8 passed: both
endpoints returned correct, ownership-scoped data and the invalid-uuid case cleanly 404'd.

**In plain terms:** add the backend "windows" to pull up a past research session and its diary.
The visual timeline that displays them is Phase 4. This sprint just makes the data fetchable.

**Concept:** The Phase 4 UI needs to fetch a past session + its steps. Phase 3 builds the
**backend** (blueprint API surface: `/research/{id}`, `/research/{id}/trace`); the timeline UI is
Phase 4, not now.

**Built (2026-07-08):**
- `backend/main.py`. Two authenticated GETs, plus a shared `_valid_uuid()` helper (an invalid
  uuid in a PostgREST `eq.` filter would 400 → 502 via `supabase_request`; both endpoints check
  the id shape first so a garbage id is a clean 404 instead):
  - `GET /research/{id}` → the `research_sessions` row (RLS-scoped via the user's token) +
    report/status. 404 if not owned/found (not-owned and not-exists look identical — no
    ownership leak).
  - `GET /research/{id}/trace` → the ordered `execution_steps` rows for that session.
- No frontend timeline work here. The `/research` response already includes `session_id`
  (backward-compatible from 3a.2); the frontend can ignore it until Phase 4.

**Manual step (Clint):** git push → Render redeploy.

**Verified live 2026-07-08:** `docs/PHASE3-TEST-SCRIPT.md` step 8 passed — `GET /research/{id}`
returned the correct session row, `GET /research/{id}/trace` returned exactly 8 ordered steps for
the TC-3a.3-01 retry-loop session, and the all-zeros uuid returned a clean 404. See **Field
notes**.

---

## Document management fix (shipped alongside this batch, owner-reported gap)

**Status:** ✅ Live-verified 2026-07-08. `docs/PHASE3-TEST-SCRIPT.md` steps 4–5 both passed: the
document list appears with the collection's real name and refreshes after upload, and deleting a
document stops its content from being retrieved (confirmed by re-asking a question that
previously only the deleted PDF could answer).

**In plain terms:** you can now see which PDFs are in a collection and delete one without
deleting the whole collection.

**Why:** live-testing 3a.2 surfaced two related reports: uploading a new PDF still pulled up
the old one, and there was no way to see which files were even in a collection. Root cause was
the same for both — uploads are additive (nothing ever replaced or removed a document's chunks)
and the frontend showed only a bare `collectionId` string, no document list.

**Built (2026-07-08):**
- `backend/main.py`. `GET /collections/{id}/documents` (ownership-checked, returns
  id/filename/status/created_at). `DELETE /documents/{id}` (ownership-checked via RLS,
  best-effort Storage purge mirroring `delete_collection`'s pattern, then the DB delete — which
  cascades to `document_chunks` per `001_core_schema.sql`, immediately stopping that PDF's
  content from being retrieved). Deleting a document mid-research is accepted as harmless:
  chunks already fetched by an in-flight run stay in that run's own memory.
- `frontend/app/dashboard/UploadPanel.tsx`. The open-collection view now shows the collection's
  **name** (previously a bare id) and a document list (filename, status, Delete button),
  refetched after every upload and delete.

**Manual step (Clint):** none beyond the batch's git push.

**Verified live 2026-07-08:** `docs/PHASE3-TEST-SCRIPT.md` steps 4–5 (document list/upload
refresh, delete fixes stale retrieval) both passed. See **Field notes**.

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

1. **Migration 007 (`hnsw_vector_index`):** paste into the Supabase SQL editor by hand; replaces
   the ivfflat index with HNSW to fix the vague-query zero-recall bug. Verify with a "summarize"
   query returning chunks afterward. (Sprint 3a.1)
2. **Migration 008 (`execution_steps`):** paste into the Supabase SQL editor by hand; verify
   `execution_steps` exists with its RLS policy and grants. (Sprint 3a.2) **No further migration
   is needed for 3a.3-3a.5 or the document management fix** — `completed_with_fallback` fits in
   the existing unconstrained `status` column, and everything else is application code.
3. **Langfuse Cloud:** create account and project, copy keys, set `LANGFUSE_*` env on Render.
   Done 2026-07-08. (Sprint 3a.4)
4. **Tavily:** create account, set `TAVILY_API_KEY` on Render. (Phase 3b only)
5. **Deploys:** every sprint ends with a git push (commits and pushes are always manual); Render
   and Vercel rebuild on push. "Deployed" means the live URLs were re-checked. Render free tier:
   first hit after idle is 30–60 s, not a bug.
6. **Live test:** run `docs/PHASE3-TEST-SCRIPT.md` top to bottom after the push lands; it covers
   everything in this batch (3a.2 leftover chaos test through 3a.5) in one sequential pass.

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
| 2026-07-08 | 3a.1 | Heisenbug: bare "summarize" sometimes returns "No relevant information found" while "summarize " (trailing space) or a retry answers. Hardened rather than guessed: normalized the query (strip) at entry so whitespace can't change the answer; added retriever logging of embedding dim + rows-per-sub-query; made `embed_query` validate a 384-float vector and raise loudly instead of silently passing a bad shape through. | this sprint, plus a reusable observability + fail-loud lesson for every embedding/model call | whitespace-hardened; root cause FOUND (see next row) |
| 2026-07-08 | 3a.1 | ROOT CAUSE (from the new retriever logs + the live RPC definition): embeddings and Orchestrator classification are both fine (`embed_dim=384`, correct `meta` intent). The vector search returned different row counts (0, 1, 1) for different sub-queries against the *same* collection. First hypothesis was a hidden similarity threshold in the live RPC, but pulling the live `match_document_chunks` definition disproved that: it has NO threshold, identical to the migration files. The real cause is the **ivfflat approximate index** on `document_chunks.embedding` (`with (lists = 100)`, migration 001). ivfflat buckets vectors into 100 lists and, at the default `probes = 1`, scans only the single nearest list. On a small collection the chunks are spread thinly so most lists are empty; a query whose vector lands on an empty list returns 0 rows. Different sub-query embeddings probe different lists, hence the random-looking 0/1/1 and why specific queries (which co-cluster with their answer chunk) work while vague ones (generic embedding, empty list) fail. The "trailing space" was never causal. Lesson: `lists = 100` is tuned for a large dataset (rule of thumb ~rows/1000); on a small one it destroys recall. This also revises ADR-014's premise: sub-query fan-out alone did NOT fix the vague-query case because the ANN index was silently dropping the fan-out results. | fix = replace the ANN index so retrieval reliably returns nearest chunks at this data scale | root cause confirmed; fix = HNSW (migration `007_hnsw_vector_index.sql`); applied live + re-tested 2026-07-08, "summarize"/"summary" now reliably return chunks. RESOLVED. |
| 2026-07-08 | 3a.1 | `tldr` gets flagged as possible prompt injection. Confirmed it is NOT the regex layer (no pattern in `injection_patterns.py` matches it) — it's the HF Prompt Guard classifier false-positiving on a short, out-of-distribution slang token. Expected ML failure mode; already an honest documented limitation. Deliberately NOT fixing: the only levers (raise threshold / allowlist the word) either weaken the guard against real attacks or hand attackers a bypass prefix. | future / known-limitation (injection classifier false positives on OOD short inputs) | logged, won't-fix by design; grab the actual `Prompt Guard score=` next time it happens to confirm |
| 2026-07-08 | 3a.1 | Summarizing a resume: the answer knew the body details but not the person's name. Expected RAG behavior, not a bug — the name lives in the header (chunk 0), and meta sub-queries ("purpose/findings/conclusions") don't rank a name chunk into the top-N, so the model never saw it. Cheap future enhancement: for `meta` intent, always include chunk_index 0 (title/author/intro almost always live there) so "what is this / who wrote it" is answerable. | future (retrieval tuning for meta intent) | implemented in 3a.2 (see below), not yet live-verified |
| 2026-07-08 | 3a.2 | Built the fix for the row above: `retriever.py` now fetches each document's `chunk_index=0` and prepends it (deduped, capped at 3) whenever `intent == "meta"`, so lead chunks survive the top-N cap. `specific`/`broad` untouched. Also built the Debug Diary: `step_writer.py` (`record_step` + `traced` decorator), all four nodes wrapped, `research_sessions` insert/patch + `execution_steps` rows wired into `main.py`. Every diary write (session insert, both patches, and each `record_step` call) is individually try/except-guarded so a DB hiccup degrades to "no diary this run," never a broken research response — the blueprint's iron rule applied at every layer, not just inside StepWriter. | this sprint | code-complete, py_compile clean; needs migration 008 applied + live test |
| 2026-07-08 | 3a.2 | Live-tested the happy paths: normal query, injection gate, vague query all PASS. The TC-3a.2-01 chaos test (diary write failure) had not been run yet at that point — folded into this batch's test script instead of testing it in isolation. | this sprint | superseded by the bundled test script below |
| 2026-07-08 | doc mgmt | Two related reports from live testing: uploading a new PDF into a collection still surfaced the old PDF in answers, and there was no way to see which files were even in a collection. Root cause was one thing, not two — uploads are purely additive (nothing ever deleted or replaced a document's chunks) and the UI showed only a bare collection id. Fixed with a document list + per-document delete (backend `GET .../documents` + `DELETE /documents/{id}`, frontend list in `UploadPanel.tsx`). | this sprint | code-complete; needs live verify |
| 2026-07-08 | 3a.3/3a.4/3a.5 | Bundled the remaining Phase 3a sprints (Critic + bounded loop, Langfuse, session read endpoints) into one batch with the document-management fix, per Clint's request to test the whole remaining phase in one sitting rather than sprint-by-sprint. One deviation from the original sketch: Langfuse ships without a `langfuse_breaker` — its SDK delivers on a background thread, so there's no request-path failure for a breaker to guard against (see ADR-016). | this sprint | code-complete, py_compile + `npm run build` both clean; needs migration 008 (if not already applied) + live test via `docs/PHASE3-TEST-SCRIPT.md` |
| 2026-07-09 | 3a.4 | Clint asked to install Langfuse's official Claude Code skill and re-instrument following its documented best practices. Following it (documentation-first, always fetch current docs) surfaced that the prior day's `langfuse==2.60.10` pin was based on an unmeasured RAM assumption. Measured it for real (clean-venv import RSS): v4 costs ~4MB more than v2, not the "real RAM cost" this file and ADR-016 originally claimed — negligible next to langgraph's own ~100MB. Upgraded to `langfuse==4.13.1`, added `openinference-instrumentation-groq` for automatic model/token capture, kept manual-span instrumentation (not the LangChain CallbackHandler Langfuse generally recommends) specifically because the CallbackHandler auto-captures full node state — full chunk content, full answers — which would leak far more to a third-party cloud service than ADR-013's disclosed sub-processors and the diary's own truncated-detail rule allow. Verified end-to-end with a real smoke test (not just py_compile): spans created correctly, exceptions propagate through the span wrapper untouched, and a real 401 from intentionally-fake API keys during background export never reached the process. Breaking rename: `LANGFUSE_HOST` → `LANGFUSE_BASE_URL` (Clint already had the old name set on Render from the prior day — flagged prominently as a required manual step). Full reasoning in ADR-016 (revised). | this sprint | code-complete, py_compile clean, smoke-tested locally against real Langfuse v4; still needs the full live test via `docs/PHASE3-TEST-SCRIPT.md` (step 9's model/token capture check is new) |
| 2026-07-08 | 3a.2 | TC-3a.2-01 chaos test run live: revoked the `execution_steps` INSERT grant, ran a real query, got a normal report the whole way through (200 OK). Render logs show the `[ARGUS] execution_steps write failed ...` print line for every node instead of a crash. Bonus: this same run organically triggered the Critic's retry loop (8 nodes total, two full retriever/synthesizer/critic passes) while the diary writes were also broken, so both failure-tolerance mechanisms were exercised independently in one shot and the request still completed. | this sprint (3a.2 closing gate) + partial live evidence for 3a.3 | TC-3a.2-01 PASS, recorded in `ADVERSARIAL-TESTS.md`; TC-3a.3-01 still needs its deliberate forced-retry test (step 7) to formally close |
| 2026-07-08 | regression | Double-login-on-first-attempt reconfirmed live during this test session (first login attempt silently fails, second succeeds). Real root cause found (not what `BACKLOG.md` Item 5 originally guessed): `last_active`, the idle-timeout cookie (`frontend/proxy.ts`), is a 7-day cookie only ever deleted inside the idle-timeout's own redirect. Any other way a session ends (explicit logout, or a Supabase session simply expiring) leaves it behind with a stale timestamp; the next login's first authenticated request compares "now" against that stale value, sees >30 minutes, and force-signs-out a session that just started — the false idle-signout is the only thing that deletes the stale cookie, which is why the second attempt always worked. | BACKLOG.md Item 5 | fixed — `last_active` now also cleared in `proxy.ts`'s not-logged-in redirect and in `app/auth/signout/route.ts`; `npm run build` clean; needs a live re-test (log out, wait >30 min or age the cookie manually, log back in once) |
| 2026-07-08 | 3a.2 / doc mgmt | `docs/PHASE3-TEST-SCRIPT.md` steps 2 ("summarize this for me" answers well) and 4–5 (document list works, deleted PDF's content no longer retrieved) all passed live. | closes 3a.2 + document management verification | PASS |
| 2026-07-08 | 3a.3 | Forced-retry test (step 7) confirmed the ASI10 loop cap works: retry fired, ran exactly 2 critic passes, terminated cleanly (`status: completed_with_fallback`), retry queries genuinely redirected the second search to different, better chunks. But the final badge read "High" instead of the expected "⚠️ Low" — the draft was still a refusal on both passes, and the Critic's system prompt says a refusal should always grade low, but the model's second-pass judgment treated that refusal as grounded in the new chunks it saw that time. Not a code bug (routing/capping/rendering all did exactly what the code says with whatever verdict the model returned); a real LLM instruction-following inconsistency between passes. | future: consider whether the Critic's system prompt needs a more forceful "always low on refusal, no exceptions" instruction, or whether this behavior is actually reasonable and doesn't need changing | open, non-blocking, logged in `ADVERSARIAL-TESTS.md` TC-3a.3-01 |
| 2026-07-08 | 3a.5 | Step 8 read-endpoints check passed live: `/research/{id}` and `/research/{id}/trace` returned correct, ownership-scoped data (trace showed exactly 8 steps for the retry-loop session), invalid uuid returned a clean 404. | closes 3a.5 verification | PASS |
| 2026-07-08 | 3a.4 | Checked Langfuse Cloud after the step 7/8 tests — no traces at all. Root cause found via `git status`: none of this session's changes (Langfuse v4 rewrite, login-bug fix) had actually been pushed yet, so the live backend was still running the pre-v4 Langfuse code, which likely still reads the old `LANGFUSE_HOST` env var name. If that was already renamed to `LANGFUSE_BASE_URL` on Render per the earlier instruction, the old deployed code would see it as unset and silently disable Langfuse. Not a new bug — a deploy-sequencing gap in how this session's testing was paced against pushes. | this batch | waiting on `git push`; steps 9-10 to be re-run after redeploy |
|  |  |  |  |  |

---

## ADRs

- **ADR-014.** Orchestrator intent routing via sub-query expansion + the vector-index fix.
  Written 2026-07-08.
- **ADR-015.** Bounded re-retrieval loop + Critic. Written 2026-07-08.
- **ADR-016.** Langfuse Cloud over self-hosted (+ the no-breaker deviation, + the v2-over-v3
  pin). Written 2026-07-08.
- **(3b) ADR-017. Web Scout + web-content injection handling** (the new untrusted channel) —
  not yet written; due when 3b is picked up.

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
