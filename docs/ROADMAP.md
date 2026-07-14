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
| Phase 3a — Full agent pipeline + observability (all sprints + document management) | ✅ live-verified 2026-07-08 |
| Phase 3b — Web Scout | ✅ live-verified 2026-07-09 |
| Phase 4 — Dashboard, sessions, public landing, chatbot, multimodal | 🟡 in progress (4.1–4.4 ✅ live-verified; presentability pass + 4.5 + 4.6a built 🟡 awaiting live tests; 4.6b/4.6c + final design pass remain) |
| Phase 4b — Admin-role SOC features (parking lot, not scheduled) | ⏳ not started |
| Phase 5 — MCP Server, CI/CD, Polish | ⏳ not started |

---

## Phase 3a — closed 2026-07-08

Every sprint (Orchestrator, Debug Diary, Critic + bounded loop, Langfuse, session read endpoints)
plus the document management fix ran the full `docs/PHASE3-TEST-SCRIPT.md` walkthrough and passed
live. All results recorded in `docs/ADVERSARIAL-TESTS.md`; every sprint status in `docs/PHASE3.md`
is ✅.

---

## Phase 3b — Web Scout (live web search) — closed 2026-07-09

**Why it was gated:** web text is a new untrusted input channel. Everything built through 3a
assumes the only untrusted content is inside a user's own uploaded PDF; a live web result is
untrusted in a different way (arbitrary third party, no upload-time scan). It got its own threat
model before being built, not folded into 3a as an afterthought — see `docs/ADR-017.md`.

**Built, revised from the original sketch above** (the sketch predated Sprint 3a.3's Critic and
its retry cycle, which the "alongside the Retriever" wiring would have collided with — full
reasoning in ADR-017):
- New agent `backend/app/agents/web_scout.py`. Calls **Tavily** for real-time snippets, tags them
  `trust_level='web_scraped'`, runs them through the same shared regex already used for document
  chunks (`injection_patterns.matches_any`) before they reach the Synthesizer.
- New `tavily_breaker` in `circuit_breaker.py` (5 fails / 2 min / 60s → doc-only fallback).
- **Graph wiring changed to serial**: `orchestrator → web_scout → retriever → synthesizer`, not
  parallel with the Retriever as first sketched. Runs at most once per research call, never inside
  the Critic's retry loop.
- **Added Orchestrator gating**, not in the original sketch: the Orchestrator judges
  `use_web: true|false` per query as part of its existing classification call (no second Groq
  call); Web Scout self-skips with zero network I/O when false. Avoids a billable Tavily call +
  latency + wider attack surface on every question, including ones the PDF already answers.
- Env: `TAVILY_API_KEY` on Render (optional — degrades cleanly to doc-only if unset).
- New adversarial gates GATE-14 through GATE-17 in `docs/ADVERSARIAL-TESTS.md`: injection via a
  web result neutralized like a poisoned chunk; a Tavily outage degrades, not 500; a benign
  web-augmented query lists web sources; a purely document-answerable question doesn't call
  Tavily at all (gating actually works).

**Exit condition — met 2026-07-09:** `docs/PHASE3B-TEST-SCRIPT.md` ran live against the deployed
app. GATE-15 (Tavily outage), GATE-16 (benign web-augmented query), and GATE-17 (orchestrator
gating) all PASS with real `execution_steps` diary evidence, recorded in `docs/ADVERSARIAL-TESTS.md`.
GATE-14 (web-content injection) is an honestly-documented **inconclusive** — the mechanism is
proven (real Tavily fetches, scanned and cited correctly) but no live-fetched snippet happened to
contain the trigger phrase within its excerpt, the same accepted non-determinism GATE-14 already
allows for. A real regression was found and fixed mid-verification: the `use_web` prompt addition
grew the Orchestrator's system prompt enough to trip a reasoning-token-budget truncation bug
(same class as ADR-014); fixed same day with `max_tokens` 768→1024 in `orchestrator.py`. Full story
in `docs/PHASE3.md` field notes and `docs/ADR-017.md`'s revision section.

---

## Phase 4 — Make it visible

**Full plan:** `docs/PHASE4.md` (sprint-by-sprint build log, mirrors `docs/PHASE3.md`'s
structure) and the approved planning doc at
`C:\Users\muri\.claude\plans\okay-now-plan-the-deep-eich.md`. Locked decisions and design
rationale for every sprint live in `docs/ADR-018.md` (Sprint 4.1) and later per-sprint ADRs.

**Scope, locked 2026-07-09: Phase 4 is a read-only, per-user dashboard — no admin role, no
cross-user visibility.** `docs/BLUEPRINT.md`'s original Phase 4 sketch (world map, global
request feed, IP intelligence, `admin_settings` kill-switch) assumed an admin role and tables
that don't exist; that scope moves to an explicitly-named **Phase 4b**, not scheduled, not
implied as built. Full reasoning: `docs/ADR-018.md` Part 3.

**Six sprints:**
- **4.1 — Backend hardening + honest-docs split.** `hf_embedding_breaker` (closes BACKLOG Item
  6), `GET /research` session-list endpoint, reporter banner reorder, the shared
  `call_reasoning_json()` helper (ends a token-truncation bug that independently hit three
  agents — ADR-018 Part 1), migration 009 (Realtime publication for `security_events`), this
  doc pass.
- **4.2 — Theme system + SOC page.** Dark/light/system theme toggle; per-user breaker health
  panel (`/status/breakers`, built in Phase 2/3 as `/health/circuit-breakers`, renamed in 4.2
  because privacy filter lists block `/health*` on Render domains in the browser) + a live
  `security_events` feed via Supabase Realtime.
- **4.3 — Sessions, timeline, report UX, cancel.** Session history list + deep-linkable
  session URLs; `ExecutionTimeline` UI (the Debug Diary's frontend, consuming
  `/research/{id}/trace`, live since Sprint 3a.5); Sources/Confidence moved behind a "show
  details" toggle; upload/research cancel support; in-browser PDF preview before upload commits.
- **4.4 — Public landing + Google sign-in + usage limits.** `/` becomes a public marketing
  page (today it force-redirects to `/dashboard`); Google OAuth signup; per-user
  `usage_limits`, owner-editable in Supabase Studio, visible in the UI. ✅ **Live-verified + CLOSED
  2026-07-11** (`docs/PHASE4.md` Sprint 4.4, `docs/ADR-019.md`; GATE-23/24 ✅). Four live review
  passes fixed real bugs along the way (stale-auth CTA, the OAuth URL-config error, the raw-JSON
  error display, the duplicate-collection bug, and the research-cap bypass → migration 014
  `usage_events`). Honest gate that remains: ADR-019 records that building the OAuth button does
  NOT discharge ADR-013's privacy-policy / sub-processor-disclosure items — enabling real public
  signups stays gated on those.
- **4.5 — Project Q&A chatbot + rate limiting.** 🟡 Built 2026-07-11 with its threat model first
  (`docs/ADR-021.md`): public Gemini-backed `/chat`, static grounding, per-IP window + persisted
  global daily cap (migration 016). Live-test fix batch 2026-07-12. 2026-07-13: the widget now
  also mounts inside the dashboard (navigation help for signed-in users) and its grounding gained
  the author's professional contact channels — same backend, same limits, still tokenless.
- **4.6 — Multimodal PDF ingestion + Report Generation.** 🟡 **4.6a (Report Generation core)
  code-complete 2026-07-13 + two live-test fix batches; 4.6b (generated figures) code-complete
  2026-07-14.** 4.6a (`docs/ADR-022.md`, GATE-28): quota-meter-paced generation on Groq's
  `gpt-oss-120b` bucket behind its own breaker, **Quick draft** (one sampled call, seconds on a
  warm dyno) / **Full report** (thorough, paced) modes, live progress, async generate + poll,
  preview → editable **`.docx`** download, non-optional proofreading disclaimer,
  `error_detail` reasons, metered via `usage_events` + migrations 017–020. (A fix-batch-#3 fpdf2
  **PDF** download was built then removed 2026-07-14 — unreliable download + an editable .docx
  beats a locked PDF; ADR-022 §5.) 4.6b
  (`docs/ADR-024-report-figures.md`, GATE-30): model-emitted chart *specs* (never images,
  source-material numbers only) hard-validated server-side, theme-aware SVG in the preview,
  matplotlib PNGs in the `.docx`. Upload-security audit + hardening landed the same pass
  (`docs/ADR-023-upload-security.md`, GATE-29; PyMuPDF CVE-2026-3029 bump). Still to build:
  **4.6c** multimodal image reading (own threat-model ADR first — image-borne injection is a
  new, currently-uncovered attack surface; see `docs/BACKLOG.md` Item 4).

**What's buildable in 4.1–4.4 with zero new admin machinery:** every user already has RLS
row-level access to their own `security_events` and `research_sessions`; Realtime honors that
same policy per subscriber. A per-user events feed, breaker panel, and session history need no
role system at all — see `docs/ADR-018.md` Part 3 for exactly which BLUEPRINT-sketched features
require 4b instead.

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
| 2026-07-08 | Idea: viewing multiple reports/sessions together (comparing runs side by side), raised while scoping the document management fix. | enabled-but-deferred 2026-07-09: Phase 4.1's `GET /research` + deep-linkable session URLs (Sprint 4.3) make this possible via two browser tabs; a dedicated compare view stays an owner note for 4b+ |
| 2026-07-08 | `tldr` gets flagged as possible prompt injection by the HF Prompt Guard classifier (false positive on a short, out-of-distribution slang token). Deliberately won't-fix: the only levers (raise threshold / allowlist the word) either weaken the guard against real attacks or hand attackers a bypass prefix. | won't-fix by design |
| 2026-07-09 | UX/product question raised while live-testing Sprint 3a.3: is showing the raw `## Sources` chunk list and the `## Confidence` section to the end user appropriate for a released/recruiter-facing product, or is that developer-stage debug info? | decided + scheduled 2026-07-09: moves behind a "show details" toggle in Sprint 4.3, normal users see a clean answer + confidence badge |
| 2026-07-09 | Idea: an in-browser PDF preview step before a document is committed to a collection — user sees the PDF and explicitly approves/rejects/re-selects the file, instead of upload going straight from file picker to processing. | scheduled 2026-07-09: pulled into Sprint 4.3 |
| 2026-07-09 | Reminder (not new, re-flagged so it doesn't get lost): PyMuPDF only reads text, so images/figures/charts inside a PDF are invisible to ARGUS today; Google sign-in is still email/password only. | Google sign-in: 🟡 **built in Sprint 4.4 (2026-07-11)**, code-complete, awaiting Clint's provider config + live verification (ADR-019). Image/figure reading: still scheduled for Sprint 4.6 with its own threat-model planning pass (image-borne injection is a new channel) |
| 2026-07-09 | n8n/Zapier automation, raised while scoping Phase 4. No concrete use case named yet. | **use case named 2026-07-11**: an n8n-automated contact-email form inside the landing page's "Get in touch" popup, same setup as the portfolio site. Blocked on Clint providing the n8n webhook URL + adding its domain to the CSP `connect-src` in `frontend/proxy.ts`. The popup shipped 2026-07-11 with direct channels (email copy/mailto, LinkedIn); the form gets added when the URL exists — no fake form in the meantime |
| 2026-07-09 | Response time on research queries/uploads feels slow, raised during Sprint 4.1 live testing. Not diagnosed yet — plausible contributors: Render free-tier cold start, sequential agent calls (orchestrator → web_scout → retriever → synthesizer → critic → reporter, each a network round trip), Groq reasoning-model latency, HF embedding round trips. No profiling done yet to say which one actually dominates. | open, not designed — needs profiling before any fix is picked, not a guess-and-optimize |
| 2026-07-11 | **Presentability pass — committed, not optional.** Clint has flagged the "bland UI" across multiple sprints; on 2026-07-11 he confirmed the plan order (landing + auth first) but explicitly required that Phase 4 does not close without the app looking presentable. The design *tokens* are done (`globals.css`); what's missing is an icon set (none installed — nav/buttons are text-only), consistent component craft on top of the tokens (typographic scale, spacing rhythm, hover/press states), a real **Settings page** (currently a disabled "coming soon" stub in `ProfileMenu`), and proper empty/loading/error states. Sprint 4.4's public landing page is the design showcase where the visual language gets defined; this pass **back-applies that language across the dashboard/workspace/sessions/SOC and builds the Settings page**. Scope additions from the 2026-07-11 live review: the **login page** (currently bare — form + back-link only, Clint calls it stale) and **richer scroll interactivity/animation** on the landing and overall UI. | 🟡 **Built 2026-07-14 as Sprint 4.7** (phases 1-4 in one pass — visual/motion craft layer, How-to page + interactive tour, charts-in-Ask, "Generate another version"; see PHASE4.md). Code-complete, not live-verified. Still open: the revise-with-note loop half of retain-and-revise, and security testing of the new surfaces. |
| 2026-07-11 | **LinkedIn post draft** to present ARGUS publicly — prepare it for Clint's review (his voice, no inflation, links to the live app + repo). Natural moment: when Phase 4 closes with the presentability pass done, so the screenshots are worth posting. | queued — not started |
| 2026-07-11 | **ARGUS logo** — Clint wants to use a design agent/tool to create a proper logo (currently the wordmark is styled text). Feeds the presentability pass (favicon, header, OG image) but is its own creative task. | queued — not started |
| 2026-07-11 | **Language support (i18n)** — Clint wants future multi-language support, deliberately limited to a few select languages (candidates TBD with him; likely English + Filipino first). Real scope when picked up: a locale switcher, translated UI strings (next-intl or the App Router's own i18n routing), and a decision about whether generated reports/answers follow the UI language. Not started, not designed. | queued — future phase, note only |
| 2026-07-11 | **Simulated subscription tier + "reset usage" reward** — specific users get automatically raised (and periodically reset) usage limits, as if subscribed; the "subscribe" mechanism itself stays locked/disabled since this is not a profit-first project (it demonstrates the capability, it doesn't charge anyone). **Clint's clarified ask (2026-07-11): a genuine "reset this user's usage" action**, not just manually raising a cap or deleting their data. The two limit *kinds* reset differently, and the design must respect that: (1) **research** is a RATE limit — after migration 014 its usage lives in the append-only `usage_events` table, so a reward "reset" = an admin-triggered clear/credit of that user's events in the window (or a per-user "granted extra runs" offset), cleanly possible now that usage is separate from deletable data; (2) **collections/documents** are OWNERSHIP quotas (count of live rows) — there is no "usage counter" to reset, so a reward there means raising the cap, OR redefining them as period-based *create* limits (a real schema change: track creates-per-period separately from live-row count, with its own reset). What does NOT exist yet: any automatic tier logic, the reset action itself, period-create tracking for collections/documents, or an admin surface to manage any of it — all role/admin machinery, i.e. **Phase 4b** scope. `usage_events` (014) is the foundation the research half of this will build on. | parked for 4b — not this phase, per the locked read-only-no-roles decision. The insight above is recorded so the eventual design starts from it |

---

## Security & scaling notes — flagged for Opus, not evaluated (2026-07-09)

Clint found these terms while researching independently and wants each one checked for actual
relevance to ARGUS before anything gets built. **None of the below have been assessed against this
project's real architecture, traffic, or scale** — recorded exactly as raised so a future planning
session evaluates each on its merits rather than defaulting to "add it because it's a known best
practice." This project's own rule applies here: no overengineering unless a need is genuinely
established first.

- **Rate limiting** — per-user or per-IP request throttling on the backend. **Shipped in Sprint 4.5
  (🟡 2026-07-11, ADR-021):** the public `/chat` endpoint has an in-process per-IP sliding window +
  a persisted global daily cap (`chat_usage` + `bump_chat_usage` RPC, migration 016). Scoped to that
  one public endpoint — authenticated-route limiting (research/upload) is still deferred, no traffic
  evidence yet to justify it there. (Note: authenticated usage IS metered separately by the
  `usage_limits` free-tier caps from Sprint 4.4, a different mechanism for a different purpose.)
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

- `docs/PHASE3.md` — the detailed Phase 3 sprint-by-sprint build log and field notes.
- `docs/PHASE3-TEST-SCRIPT.md` — the Phase 3a live verification walkthrough.
- `docs/PHASE3B-TEST-SCRIPT.md` — the Phase 3b (Web Scout) live verification walkthrough.
- `docs/PHASE4.md` — the Phase 4 sprint-by-sprint build log, same structure as PHASE3.md.
- `docs/ADVERSARIAL-TESTS.md` — the running adversarial/chaos test suite.
- `docs/BLUEPRINT.md` — the original target architecture and OWASP/ASI risk map.
- `docs/ADR-017.md` — the Web Scout threat model, graph-wiring, and gating decisions.
- `docs/ADR-018.md` — the shared reasoning-JSON helper, the HF embedding breaker, and the
  Phase 4 / 4b split.
- `CONTINUITY.md` (repo root, gitignored) — the private working log between sessions.
