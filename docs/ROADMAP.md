# ARGUS — Roadmap

The master plan for everything left to build. Read this first at the start of any future
planning session — confirm it's still accurate against the current code and docs before adding
to it, since project state moves faster than any single document.

## Status-marks rule (applies everywhere in this project)

⏳ not built · 🟡 code-complete, not yet verified against the live deployed app · ✅ verified live.
Compiling or passing a local build is not ✅. Docs never claim more than the code does — if a
change makes any doc stale, fix it in the same turn.

---

## Where the project stands

| Phase | Status |
|---|---|
| Phase 1 — Core RAG pipeline | ✅ |
| Phase 2 — Security hardening | ✅ |
| Sprint 3a.1 — Orchestrator + intent retrieval | ✅ |
| Sprint 3a.2 + document management | ✅ live-verified 2026-07-08 |
| Sprints 3a.3–3a.5 | 🟡 code-complete, awaiting `docs/PHASE3-TEST-SCRIPT.md` steps 6–11 |
| Phase 3b — Web Scout | ⏳ not started |
| Phase 4 — SOC Dashboard | ⏳ not started |
| Phase 5 — MCP Server, CI/CD, Polish | ⏳ not started |

---

## Phase 3a — closing gate

Everything in this batch (Critic + bounded loop, Langfuse, session read endpoints, document
list/delete) is code-complete but unverified. `docs/PHASE3-TEST-SCRIPT.md` is the exit condition
for Phase 3a — run it top to bottom, record every chaos/security test in
`docs/ADVERSARIAL-TESTS.md`, and flip each sprint's status in `docs/PHASE3.md` from 🟡 to ✅ once
its steps pass. Only after every 3a item is ✅ does 3b begin.

---

## Phase 3b — Web Scout (live web search)

**Why it's gated:** web text is a new untrusted input channel. Everything built through 3a
assumes the only untrusted content is inside a user's own uploaded PDF; a live web result is
untrusted in a different way (arbitrary third party, no upload-time scan). It gets its own threat
model before it's built, not folded into 3a as an afterthought.

**Sketch** (detailed sprint plan + a dedicated injection threat model get written when this is
picked up, as its own ADR-017):
- New agent `backend/app/agents/web_scout.py`. Calls **Tavily** for real-time snippets, tags them
  `trust_level='web_scraped'`, runs them through the same injection guard / shadow scan already
  used for document chunks.
- New `tavily_breaker` in `circuit_breaker.py` (5 fails / 2 min / 60s → doc-only fallback).
- Graph: Web Scout runs alongside the Retriever, both feeding the Synthesizer. Tavily down →
  proceed doc-only with a banner, same degrade-gracefully pattern as every other external call.
- Env: `TAVILY_API_KEY` on Render.
- New adversarial gates (GATE-14+): injection via a web result must be neutralized exactly like a
  poisoned chunk; a Tavily outage must degrade, not 500.

---

## Phase 4 — Make it visible

**SOC dashboard** (per `docs/BLUEPRINT.md`): a live view of the system's own health and security
events — breaker states (already exposed via `/health/circuit-breakers`), a `security_events`
feed, IP intelligence / world map, Supabase Realtime subscriptions for live updates. The last
remaining circuit breaker (`ip-api.com`) ships here.

**Research timeline UI**: a frontend view of a past session's Debug Diary, consuming the
`/research/{id}` and `/research/{id}/trace` endpoints that already shipped in Sprint 3a.5. The
backend data is ready; this phase is purely the visual layer on top of it.

---

## Phase 5 — MCP Server, CI/CD, Polish

MCP server as its own separate FastAPI app (not a second app object inside an existing service —
see the service-separation note in `docs/BLUEPRINT.md`). Full GitHub Actions pipeline (test +
adversarial + build + deploy). README, architecture diagram, live demo link. `DEVLOG.md` with
ADRs written as decisions are made, not retroactively.

---

## Deferred by explicit decision (not gaps — don't silently reopen these)

| Item | Why deferred |
|---|---|
| RAGAS scoring | Heavy dependency + extra LLM calls per query; the Critic's grounded-ness flags deliver the confidence-badge story now without the added latency/cost on free-tier Groq |
| `match_document_chunks` RPC similarity threshold | The Orchestrator's sub-query merge + the HNSW index fix (ADR-014) close the retrieval-quality gap without a schema change |
| Self-hosted Langfuse | Cloud free tier gives the same tracing with zero added infrastructure (ADR-016) |

---

## Owner notes stack

Ideas and observations that don't belong to a specific in-flight sprint yet. Graduate an item into
a real sprint plan when its phase comes up; don't let it sit here forever unaddressed.

| Date | Note | Status |
|---|---|---|
| 2026-07-08 | Idea: viewing multiple reports/sessions together (comparing runs side by side), raised while scoping the document management fix. Not designed yet — needs its own UX thinking, likely a Phase 4 concern once the timeline UI exists. | open |
| 2026-07-08 | `tldr` gets flagged as possible prompt injection by the HF Prompt Guard classifier (false positive on a short, out-of-distribution slang token). Deliberately won't-fix: the only levers (raise threshold / allowlist the word) either weaken the guard against real attacks or hand attackers a bypass prefix. | won't-fix by design |
| 2026-07-09 | UX/product question raised while live-testing Sprint 3a.3: is showing the raw `## Sources` chunk list and the `## Confidence` section to the end user appropriate for a released/recruiter-facing product, or is that developer-stage debug info that should be hidden (or moved to an optional "show details" toggle) before any public release? Not decided — needs a product call, not just a code change. | open, needs Opus/product decision |
| 2026-07-09 | Idea: an in-browser PDF preview step before a document is committed to a collection — user sees the PDF and explicitly approves/rejects/re-selects the file, instead of upload going straight from file picker to processing. Raised alongside the document management fix (Sprint 3a.2-3a.5 batch). Not designed. | open, future phase |
| 2026-07-09 | Reminder (not new, re-flagged so it doesn't get lost): PyMuPDF only reads text, so images/figures/charts inside a PDF are invisible to ARGUS today; Google sign-in is still email/password only. Both already tracked in `docs/BACKLOG.md` from earlier sessions — noting here too since they came up again this session. | open, tracked in BACKLOG.md |
|  |  |  |

---

## Security & scaling notes — flagged for Opus, not evaluated (2026-07-09)

Clint found these terms while researching independently and wants each one checked for actual
relevance to ARGUS before anything gets built. **None of the below have been assessed against this
project's real architecture, traffic, or scale** — recorded exactly as raised so a future planning
session evaluates each on its merits rather than defaulting to "add it because it's a known best
practice." This project's own rule applies here: no overengineering unless a need is genuinely
established first.

- **Rate limiting** — per-user or per-IP request throttling on the backend. Nothing like this
  exists today. Whether it's warranted depends on real traffic patterns, which don't exist yet
  outside personal/demo use.
- **Re-authentication** — forcing a fresh login before sensitive actions. Raised generally, not
  tied to a specific ARGUS flow yet — needs a concrete "which action, why" before it's a spec.
- **Caching repeated requests with Redis** — would need a demonstrated case where the same query
  hits the backend often enough for caching to matter (and a decision on cache invalidation once a
  document's chunks change). Not established yet.
- **Making AI calls, email sending, and PDF parsing asynchronous background jobs** — instead of
  handling them synchronously inside the request/response cycle they run in today (see
  `backend/main.py`'s upload handler for the current synchronous PDF parsing path). This is a real
  architecture change if pursued — needs a job queue and worker process (e.g. Celery, RQ, or
  Render's own background worker service type), not a small patch.

---

## Related documents

- `docs/PHASE3.md` — the detailed Phase 3a sprint-by-sprint build log and field notes.
- `docs/PHASE3-TEST-SCRIPT.md` — the live verification walkthrough for the current batch.
- `docs/ADVERSARIAL-TESTS.md` — the running adversarial/chaos test suite.
- `docs/BLUEPRINT.md` — the original target architecture and OWASP/ASI risk map.
- `CONTINUITY.md` (repo root, gitignored) — the private working log between sessions.
