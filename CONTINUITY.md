# ARGUS - Continuity Brief

Paste this whole file at the start of a new chat whenever a session ends, resets, or
hits a message cap. This replaces the old pattern of writing a new PHASE-N-HANDOFF.md
at every transition, one living file, updated in place instead. Git history already
keeps old states recoverable, a new file per change isn't needed.

For full technical depth (env vars, complete ADR text, sprint-by-sprint build log), see
`PHASE1-HANDOFF.md`, `BLUEPRINT.md`, `PHASE2.md`. This file is the fast-sync layer, not
a replacement for those.

---

## Who's building this, short version

Non-technical-leaning beginner, self-described "vibe coder." Strong conceptual
instincts, weak on syntax recall. Wants concepts explained plainly before code,
confirmed before implementation proceeds. Full working-style conventions live in the
project skill file (`argus-architecture-conventions`), this section is just a fallback
in case that skill isn't loaded in whatever context this gets pasted into.

---

## Where we are right now

**Phase:** 2, Security Hardening
**Sprint:** 2.1, trust_level tagging + chunk injection guard
**Sprint status:** Deployed and live. Partially verified, security_events logging
confirmed, two pieces of evidence still pending, see below.

## This sprint, done

- [x] Migration 004: `trust_level` column on `document_chunks`, new `security_events`
  table, `match_document_chunks` RPC updated to return `trust_level`. Ran clean in
  Supabase, confirmed.
- [x] Lock #1: Synthesizer system prompt hardened, trust_level content framed as data
  to summarize, not instructions to obey. Anti-leak clause added.
- [x] Lock #2: `scan_chunks()` added to `synthesizer.py`. Regex-scans chunks before the
  model sees them, strips matches, logs to `security_events`.
- [x] `user_id` threaded through `ResearchState` and the `/research` endpoint, needed
  for Lock #2's logging.
- [x] Deployed to Render, confirmed live, no errors. `security_events` confirmed
  writing real rows with the correct `event_type` when a chunk gets flagged.

## This sprint, not done

- [ ] Confirm the other half of TC-2.1-01: does the injected override text stay out of
  the final answer, not just out of `security_events`. Logging side confirmed, output
  side not yet confirmed.
- [ ] Run TC-2.1-02 (prompt leak via query text). May fail, that's not a Lock #1/2 bug,
  it's the known gap Sprint 2.2 exists to close.
- [ ] README rewrite. Drafted once, never actually saved. Real `README.md` is still
  just `# argus`.

## Known gaps, not assigned to the current sprint

| Gap | Where | Fix planned for |
|---|---|---|
| `allow_origins=["*"]` | `backend/main.py` | Sprint 2.2 |
| `/research` never writes to `research_sessions` | `backend/main.py` | Unassigned |
| MCP tool allowlist doesn't exist yet | n/a | Sprint 2.5 (added this phase) |
| No delete-document/delete-collection endpoint. Uploaded PDFs and chunks accumulate in Storage and `document_chunks` forever, planned in BLUEPRINT.md's API surface but never built | `backend/main.py` | Unassigned |
| Missing security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) on the frontend, caught by a third-party pentest scan | `frontend/next.config.ts` | Fixed same day found, see ADR-008. Not folded into Phase 2 sprints, different domain (browser hardening, frontend) than Phase 2's scope (LLM/agent security, backend) |
| LLM03 (Supply Chain) marked closed in BLUEPRINT.md citing a pip-audit/npm audit CI gate that doesn't exist yet, no `.github/workflows/` in the repo | n/a | Phase 5. Manual check done July 5, 2026, see ADR-010, re-run by hand until then |
| Multimodal prompt injection (malicious instructions hidden inside images) not covered, since PyMuPDF is text-only there's no channel for it yet | n/a | Revisit only if image/figure reading is ever added, see ADR-010 |
| npm audit: moderate postcss XSS advisory, transitive via Next.js internals, low exploitability (no user-controlled CSS generation in this app) | `frontend/package.json` (transitive) | Low priority, tracked, not actioned, suggested auto-fix would regress Next.js |

## Sprint plan, this phase

2.1 (in progress), trust_level + chunk guard
2.2, endpoint-level injection guard (Groq classifier + regex fallback, fail-closed)
2.3, vector shadow detection
2.4, CircuitBreaker + 10-payload adversarial suite
2.5, MCP allowlist logic (added this phase, no server until Phase 5)

## Sprint 2.2, current status

**TC-2.2-01 confirmed passing live.** A second gap found during real testing, a typo
("gnore" instead of "ignore") bypassed both layers, fixed via a few-shot classifier
prompt update, see ADR-007's addendum. Logged as TC-2.2-03, re-test pending.

- [x] `backend/app/services/injection_guard.py` created, two-layer check (Groq
  classifier, regex fallback, fail-closed if both unavailable)
- [x] Wired into `/research` in `main.py`, runs before any DB call
- [x] TC-2.2-01, TC-2.2-02 written in `docs/ADVERSARIAL-TESTS.md`
- [x] Deploy, confirmed live
- [x] TC-2.2-01 confirmed passing against the live app
- [x] Dependency audit run for real (`pip-audit` clean, one tracked `npm audit`
  finding, not currently exploitable, no stable fix available yet). Full writeup:
  `docs/SECURITY-RESEARCH-LOG.md`
- [ ] TC-2.2-02 (Groq-unreachable/regex-fallback test), not yet confirmed
- [ ] TC-2.2-03 (typo bypass), fix applied, re-test pending
- [x] Known shared-drift risk noted: `QUERY_INJECTION_PATTERNS` in
  `injection_guard.py` and `INJECTION_PATTERNS` in `synthesizer.py` are two separate
  lists doing similar jobs, merge into one shared module when Sprint 2.3 needs the
  same pattern list a third time.

---

## How to keep this file useful, read before editing

- Something in "not done" gets finished: move it, don't just delete it. Cut the line,
  paste it under "done" for that sprint.
- A sprint fully closes: collapse its whole "done" list into one line under a
  "Completed sprints" section (add one if it doesn't exist yet). Don't keep every old
  checkbox forever, git history and the Build Log in PHASE2.md already cover that.
- New gap found mid-sprint that isn't this sprint's job: add it to the gaps table with
  an honest "Unassigned" if nothing owns it yet. Don't leave it undocumented.
- If this file is getting long, collapse finished sections. Don't split it into a
  second file, that's the exact problem this file exists to avoid.
