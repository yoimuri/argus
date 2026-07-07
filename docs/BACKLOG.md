# ARGUS — Future-Work Backlog

Durable home for work identified but deliberately not built yet. Each item has enough
grounding (root cause where known, relevant files, phase assignment) that a future session
can start productively instead of re-deriving context. Not an execution-ready spec. Full
implementation planning happens when a session picks an item up.

Phase 2 (Security Hardening) closed 2026-07-07. See `docs/PHASE2.md` and
`docs/ADVERSARIAL-TESTS.md` for the closing gate run. Everything below is post-Phase-2 work.

---

## Confirmed phase assignments

Phase 2's scope is LLM/agent security specifically (injection, extraction, poisoning,
resilience, MCP allowlist. The 13 gates). Checked each item below against that scope before
closing Phase 2, to make sure nothing here was secretly a Phase 2 requirement:

| Item | Real phase | Why |
|---|---|---|
| Query intent understanding | Phase 3 (Orchestrator) | Retrieval-quality problem, not security |
| Edit / mass-delete collections | Post-Phase-2 UX | Feature gap, not security |
| Google sign-in | Pre-public-launch | Feature + privacy posture, not Phase 2 security |
| Image/figure reading | Future phase, own threat model | New injection channel, but the channel doesn't exist yet: nothing for a Phase 2 gate to test |

None of these were hidden Phase 2 blockers. Closing Phase 2 on the 13 gates skipped nothing
that belonged to Phase 2.

---

## Item 1 — Query intent understanding

**Root cause already diagnosed** (July 8, 2026 session): `backend/app/agents/retriever.py`
embeds the raw query and pulls top-5 by cosine similarity with no intent parsing, so a
vague/meta query ("summarize for me") retrieves an arbitrary sample instead of a
representative one. Confirmed live again during Phase 2 gate verification (2026-07-07),
still an open, expected gap. `docs/BLUEPRINT.md`'s own Debug Diary example already uses
"Summarize the Q3 financial report" as the Orchestrator's worked example, confirming this was
always meant to be the Orchestrator's job, not a Synthesizer prompt patch.

**Phase:** 3 (Orchestrator agent design). Not a standalone fix. A prompt patch now would be
a band-aid reworked the moment Phase 3 lands.

---

## Item 2 — Edit + mass-delete of collections (UI)

Two related but distinct gaps:
- **Edit:** collections only have a `name` field (`supabase/migrations/001_core_schema.sql`);
  no `PATCH /collections/{id}` endpoint, no rename UI. Open question: rename only, or also
  allow editing which documents belong to a collection?
- **Mass delete:** `frontend/app/dashboard/UploadPanel.tsx` has one Delete button per
  collection (calls `DELETE /collections/{id}` one at a time with a `confirm()` guard). A
  "select multiple, delete all" flow needs either (a) a loop of the existing endpoint from the
  frontend, or (b) a new batch backend endpoint. Undecided. Reuse the Storage-purge-then-cascade
  pattern already built in `delete_collection` (`backend/main.py`) either way.

**Phase:** post-Phase-2 UX, standalone.

---

## Item 3 — Google sign-in

Currently email/password only (`frontend/app/login/LoginForm.tsx`,
`supabase.auth.signInWithPassword`). Supabase Auth supports OAuth natively
(`supabase.auth.signInWithOAuth({ provider: 'google' })`). Mechanically simple, not a novel
design problem. **Real prerequisite:** `docs/ADR-013.md`'s pre-launch checklist (privacy
policy, sub-processor disclosure) stops being theoretical once real public users can sign up.
Sequence this against that checklist, not as a standalone OAuth wire-up.

**Phase:** pre-public-launch.

---

## Item 4 — Remaining README "Known limitations"

Of the six items in `README.md`'s Known Limitations section: two overlap items 1/3 above, two
are accepted structural/platform facts with nothing to plan (no classifier catches every
attack phrasing; Render cold-start delay), and two are genuinely new:

- **Image/figure reading**. `backend/app/services/document_processor.py` uses PyMuPDF's
  `page.get_text("text")` only, no vision model. Per `docs/SECURITY-RESEARCH-LOG.md`'s own
  forward-note, the current text-only injection guards would NOT automatically cover an image
  channel. This needs its own explicit threat model before building, not an assumption the
  existing guards extend to it. Largest, most architecturally novel item here. Sequence last.
- **Synchronous file processing**. `backend/main.py`'s upload handler processes inline.
  Known scaling limit, already an accepted tradeoff, not urgent.

**Phase:** image reading needs its own future phase + threat model. Sync processing:
low-priority, no phase assigned.

---

## Item 5 — UX/design debt found during Phase 2 gate verification (2026-07-07)

Four items surfaced while running the live gates, none security-relevant, all logged in
the project's gaps table:

- **Chunk-granularity quarantine.** Upload-time shadow detection (GATE-07) discards the whole
  chunk when it contains an injected tail, even if most of the chunk is legitimate content.
  Fails safe, but loses legitimate retrievable content as collateral. `backend/main.py` upload
  handler (Sprint 2.3).
- **Double login on first attempt.** The redirect URL sets `reason=idle` on the first try,
  forcing a second login. `frontend/app/login/`.
- **No per-collection file list.** Opening a stored collection doesn't show which PDF(s) are
  inside it. `frontend/app/dashboard/UploadPanel.tsx`.
- **No upload-cancel.** No way to cancel an in-progress upload, including by navigating away.
  `frontend/app/dashboard/UploadPanel.tsx`.

**Phase:** unassigned, not yet triaged. Small enough to bundle with Item 2's UI work when
that gets picked up.

---

## Item 6 — Embedding calls have no circuit breaker or retry (cold-start resilience)

`embed_query` and `embed_chunks` (`backend/app/services/document_processor.py`) call the
HuggingFace Inference API directly with no `hf_breaker` wrap and no retry/backoff. The HF
serverless endpoint cold-starts and can return a 5xx or a "model loading" payload on the
first hit after idle. As of the 2026-07-08 hardening, `embed_query` now *validates* its
result and raises loudly on a bad shape (so the failure is visible instead of a silent bad
vector), but there is still no graceful degradation: a cold-start surfaces as a failed
research request rather than a retried or degraded one.

The real fix mirrors what already exists for the injection classifier: wrap the HF call in
`hf_breaker` (`backend/app/services/circuit_breaker.py`) and add one retry with short backoff
for the model-loading case. Deferred deliberately so the diagnostic hardening could ship tight;
this is the resilience layer on top of it.

**Phase:** Phase 3 observability/resilience, or whenever a cold-start failure is actually
observed live. Not urgent until the retriever logs show it happening.

---

## Suggested sequencing (not a locked decision)

1. Item 2 (edit/mass-delete) + Item 5 (UX debt) together. Same file surface, all frontend/UploadPanel.tsx.
2. Item 3 (Google sign-in), paired with the ADR-013 checklist review.
3. Item 1 (query intent) as part of Phase 3's Orchestrator design, not standalone.
4. Item 4's image/figure reading last. Largest, needs its own injection threat model first.
