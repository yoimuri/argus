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
| Google sign-in | Sprint 4.4 (scheduled 2026-07-09) | Feature + privacy posture, not Phase 2 security |
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

## Item 3 — Google sign-in — 🟡 BUILT in Sprint 4.4 (2026-07-11), not yet live-verified

Was email/password only. Now: "Continue with Google" on `frontend/app/login/LoginForm.tsx`
(`signInWithOAuth`) + a PKCE callback at `frontend/app/auth/callback/route.ts`
(`exchangeCodeForSession`). Paired with the `usage_limits` table (migration 011) so a public
signup surface doesn't open unmetered free-tier usage. Full build log: `docs/PHASE4.md` Sprint 4.4;
design + privacy reasoning: `docs/ADR-019.md`.

**Still open (the real prerequisite, unchanged):** building the OAuth button does NOT discharge
`docs/ADR-013.md`'s pre-launch checklist (privacy policy, sub-processor disclosure, retention). Per
ADR-019, the mechanism is ready for owner testing, but **enabling real public signups stays gated**
on those items being written. Clint's manual config (Google Cloud credentials + Supabase provider)
is required before even the owner-test round-trip can run.

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
the project's gaps table. Two are now resolved (below), two are still open:

- **Chunk-granularity quarantine.** Upload-time shadow detection (GATE-07) discards the whole
  chunk when it contains an injected tail, even if most of the chunk is legitimate content.
  Fails safe, but loses legitimate retrievable content as collateral. `backend/main.py` upload
  handler (Sprint 2.3). Still open.
- ~~**Double login on first attempt.**~~ **Fixed 2026-07-08, gap found + closed 2026-07-09.**
  Root cause: `last_active` (the idle-timeout cookie, `frontend/proxy.ts`) is a 7-day cookie
  but was only ever deleted inside the idle-timeout's own redirect. Any other way a session
  ended — the `/auth/signout` route, or a Supabase session simply expiring — left it behind
  with a stale timestamp. The next login's first authenticated request compared "now" against
  that stale timestamp, saw >30 minutes, and force-signed-out a session that had just started;
  that false idle-signout was the only thing that deleted the stale cookie, which is why the
  second attempt always worked. The July 8 fix (delete `last_active` in `frontend/proxy.ts`'s
  "not logged in, redirected from a protected page" branch, and in
  `frontend/app/auth/signout/route.ts`) had never been live-verified and turned out to only
  cover one of two routes into this state. **Found live 2026-07-09** (Clint hit `reason=idle`
  on a genuinely first login attempt, not via the redirect-from-protected-page path): landing
  on `/login` directly — typed URL, bookmark, or a client-side redirect after a 401 — skips
  that branch entirely, so a stale cookie from a session that ended >30 min earlier was never
  cleared before the next login. Fixed same day: `proxy.ts` now clears `last_active` for
  *any* unauthenticated request, not just the redirect-into-`/login` case. **Recurred anyway,
  reported "random" 2026-07-10** — a stale cookie still leaks in by some path never reliably
  reproduced. Rather than a fourth guess at the leak, the 2026-07-10 fix makes the false
  positive structurally impossible: a new `/auth/activity` route stamps `last_active = now`
  server-side the moment sign-in succeeds (`LoginForm` calls it before navigating), so a fresh
  login can never be judged idle regardless of what any older cookie said. The login page also
  now explains an idle signout in plain words instead of a bare `?reason=idle` URL. 🟡 until
  Clint's live re-test (several login cycles + one after 30+ min away, no first-login bounce).
- ~~**No per-collection file list.**~~ **Fixed and live-verified 2026-07-08**, as part of the
  Phase 3a document-management fix (`docs/PHASE3.md`) — opening a collection now shows its name
  and document list.
- ~~**No upload-cancel.**~~ **Built in Sprint 4.3, redesigned twice after live failures, 🟡
  awaiting re-test of design #3 (2026-07-10).** Two disconnect-based designs failed live —
  Render's proxy buffers the request cycle, so the backend can never observe a client abort in
  any form (`asyncio.CancelledError` never raised; `request.is_disconnected()` never flips).
  Design #3 puts the cancel signal in the DB instead: client-generated ids sent up front, Cancel
  = `DELETE /documents/{id}` (upload loop polls its own row's existence between embedding
  batches) / `POST /research/{id}/cancel` (pipeline checks the flag before every agent).
  Navigate-away fires the same calls with `keepalive`. The storage-js soft-cancel limitation
  from the first cut still applies to the Storage-upload leg. Full trail: `docs/PHASE4.md`
  Sprint 4.3 "Rework #2"; gate: GATE-25. If design #3 also fails live, the honest fallback is
  hiding the button until the async-jobs rearchitecture — no fourth design exists on a
  synchronous transport.

**Phase:** unassigned, not yet triaged. Small enough to bundle with Item 2's UI work when
that gets picked up.

**Owner note (2026-07-10, from Clint's feedback):** session history should eventually
auto-expire after N days (or offer "request deletion") — needs `pg_cron` or an external
scheduled job, neither of which exists in this stack yet, so it's parked here rather than
half-built. Manual per-session delete shipped in Sprint 4.3 (`DELETE /research/{id}`).

---

## Item 6 — Embedding calls have no circuit breaker or retry (cold-start resilience)

**Closed, Sprint 4.1 (2026-07-09).** `embed_query` and `embed_chunks`
(`backend/app/services/document_processor.py`) now route through a dedicated
`hf_embedding_breaker` (`backend/app/services/circuit_breaker.py`, separate from the
prompt-injection classifier's `hf_breaker` — see `docs/ADR-018.md` Part 2 for why they don't
share one), with one retry nested inside the breaker call. The `embed_chunks`/batch path,
which previously had zero response validation at all (unlike `embed_query`), now shares the
same cold-start `{"error": "..."}` detection via `_hf_embedding_once()`. A real outage now
surfaces as a clean `503` with a retry hint on `/research` and upload, not a `500` or a silent
bad vector. Per-attempt HTTP timeout also dropped 60s → 30s. Full design: `docs/ADR-018.md`
Part 2; live verification: GATE-22 in `docs/ADVERSARIAL-TESTS.md`.

---

## Suggested sequencing (not a locked decision)

1. Item 2 (edit/mass-delete) + Item 5 (UX debt) together. Same file surface, all frontend/UploadPanel.tsx.
2. Item 3 (Google sign-in), paired with the ADR-013 checklist review.
3. Item 1 (query intent) as part of Phase 3's Orchestrator design, not standalone.
4. Item 4's image/figure reading last. Largest, needs its own injection threat model first.
