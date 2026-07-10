# ARGUS — Phase 4: Dashboard, Sessions, Public Landing, Chatbot, Multimodal

**Status:** ✅ Sprint 4.1 live-verified 2026-07-09. ✅ Sprint 4.2 functionality live-verified
2026-07-09 — with its cross-user *isolation* gates (GATE-18/19/20/21) still 🟡, pending a second
test account (the SOC page is proven to show your own data, not yet proven to hide others'; see
the Sprint 4.2 section). 🟡 Sprint 4.3 code-complete 2026-07-09, not yet live-verified. Sprints
4.4–4.6 not started. Every checkbox below is ⏳ until its sprint is code-complete (🟡) and then
confirmed against the live Render + Vercel app (✅), per the project's status-marks rule. This
file is the execution plan, not a status claim.
**Timeline:** Weeks 11–13 (blueprint), realistically paced across the six sub-sprints below.
**SDLC Stages:** UI/UX Design → Realtime Integration → Public Surface → Re-deploy
**Prerequisite:** Phase 3 closed and live-verified (✅ 3a 2026-07-08, 3b 2026-07-09). Confirmed
unblocked.

---

## In plain terms (the 30-second version)

Everything built through Phase 3 works, but you can only see it by calling the API directly or
reading raw JSON — there's no dashboard, no way to browse past research sessions, and no public
page for someone who isn't already logged in. Phase 4 makes the system visible:

1. **A live health view.** Circuit breaker states and security events, updating in real time,
   not something you'd have to SSH in or query Supabase directly to see.
2. **A session history.** Every past research run, with a visual step-by-step replay of what
   each agent did (the Debug Diary's frontend — data's been ready since Sprint 3a.5).
3. **A cleaner report view.** The raw Sources/Confidence sections move behind a "show details"
   toggle; most users just see a clean answer and a confidence badge.
4. **A public front door.** Today the root URL force-redirects straight to a login wall. Phase 4
   adds an actual landing page — what ARGUS is, how it works, who built it — plus Google sign-in
   so a recruiter can try it without an email/password flow.
5. **(Sprint 4.5+) A public chatbot and multimodal document reading**, each gated behind its own
   threat-model planning pass, same discipline Web Scout (3b) went through before it was built.

**What Phase 4 deliberately does NOT include:** an admin role, a global "every user's traffic"
view, a world map, or a maintenance kill-switch. `docs/BLUEPRINT.md`'s original Phase 4 sketch
assumed those; they move to an explicitly-named **Phase 4b**, not scheduled. Full reasoning in
`docs/ADR-018.md` Part 3. Building a read-only per-user dashboard first, on RLS that already
exists, ships real value without inventing a role system this project doesn't need yet.

---

## Sprint plan

### Sprint 4.1 — Backend hardening + honest-docs split

**Status:** 🟡 Code-complete 2026-07-09, not yet live-verified. `backend` `py_compile` clean
across every touched file.

**What was built:**
- `circuit_breaker.py` — new `hf_embedding_breaker`, deliberately separate from `hf_breaker`
  (which guards the prompt-injection classifier). Same 5-fail/120s-window/60s-recovery tuning as
  every other breaker. See `docs/ADR-018.md` Part 2 for why the two HF breakers stay separate.
- `document_processor.py` — `_hf_embedding_once()` now detects HF's cold-start
  `{"error": "..."}` 200-body (previously only `embed_query` checked for this; `embed_chunks`
  had no validation at all — BACKLOG Item 6). `_hf_embedding_with_retry()` does one retry
  *inside* the function that gets passed to the breaker, so a real outage counts as one breaker
  failure, not two. Per-attempt HTTP timeout dropped 60s → 30s.
- `main.py` — `CircuitBreakerOpen` now caught explicitly in both the upload handler and
  `/research`, returned as a clean `503` with a `retry_in_s`-derived hint instead of an
  uncaught exception or a generic `500`. New `hf_embedding` entry in
  `/health/circuit-breakers`. New `GET /research` endpoint: lists the caller's own sessions
  (`?collection_id=&limit=&offset=`, clamped 1–50), metadata only (`id, collection_id, query,
  status, created_at`), no `report` field — the input the Sprint 4.3 sessions list needs.
- `llm_json.py` — new `call_reasoning_json()` + `ReasoningTruncated`. One function now owns
  every Groq reasoning-model call across `orchestrator.py`, `synthesizer.py`, and `critic.py`:
  checks `finish_reason`, retries once at a lower `reasoning_effort` on truncation, raises a
  typed error if the retry also truncates. Each agent's `max_tokens`/`reasoning_effort` and
  fail-open `except` block are unchanged — this is a drop-in replacement for the raw
  `client.chat.completions.create()` call each agent used to make directly, not a behavior
  change on the happy path. Full story (three independent recurrences of this exact bug,
  across three agents, finally consolidated): `docs/ADR-018.md` Part 1.
- `reporter.py` — the "web search unavailable" banner now renders right after the answer
  instead of between the Sources list and the Confidence badge (it explains something about how
  the *answer* was produced, not the sources). No-banner output is byte-identical to before.
- `supabase/migrations/009_realtime_security_events.sql` — idempotently publishes
  `security_events` to Supabase Realtime so Sprint 4.2's live events feed can subscribe instead
  of polling. No new RLS policy needed — migration 004's existing "own security events" SELECT
  policy is what Realtime evaluates per subscriber.
- Docs: this file, `docs/ADR-018.md` (new), `docs/BLUEPRINT.md` (breaker/degradation table,
  database schema table, API surface, Phase 4/4b roadmap split), `docs/ROADMAP.md` (Phase 4
  section rewritten, owner notes closed/graduated, n8n note added), `docs/ADVERSARIAL-TESTS.md`
  (GATE-18 through GATE-22 stubs), `docs/BACKLOG.md` (Item 6 closed, Item 3 scheduled into 4.4).

**Verify live (manual steps, Clint's):**
1. Paste `supabase/migrations/009_realtime_security_events.sql` into the Supabase SQL editor.
   Confirm via Database → Publications that `security_events` is now listed under
   `supabase_realtime`.
2. `git push` — Render redeploys the backend.
3. Normal research query → confirm the report renders exactly as before (banner reorder should
   be invisible on the no-banner path).
4. `GET /research?limit=5` (with a valid Bearer token, e.g. via the browser devtools Network
   tab after a login) → confirm it returns an array of your own sessions, no `report` field.
5. **GATE-22** — temporarily set `HF_TOKEN` to an invalid value on Render, run a query, confirm
   a clean `503` (not a `500` or a hang) with a retry-time hint, and that `/health/circuit-
   breakers` shows `hf_embedding` as `open`. Restore the real `HF_TOKEN`, confirm it recovers to
   `closed` after the next successful call.
6. GATE-18/19 need Sprint 4.3's UI (or a manual `curl` with two accounts) to fully exercise —
   record what's checkable now, finish the rest when the sessions list ships.

---

### Sprint 4.2 — Theme system + frontend foundation + SOC page

**Status:** ✅ Functionality live-verified 2026-07-09 — but the per-account *isolation* security
property is NOT yet proven (see the caveat below; only one test account exists). Theme toggle (no
stuck state, no flash), breaker panel (all 4 cards + Langfuse chip, confirmed with browser
extensions/Brave Shields on — the `/status/breakers` regression test), live security-events feed
with `user_agent` populated (GATE-20's live-append half), and the `wss://` CSP entry (implicitly
confirmed by the Realtime socket connecting) all tested against the real deployed app, not just
built.

**Honest scope of that ✅ (the project's #1 drift pattern, guarded against on purpose):** what is
verified is that the SOC feed *shows a user their own events*. What is NOT verified is that it
*hides other users' events* — GATE-18/19/20's cross-user isolation halves and GATE-21 have never
run, because there is only one test account. The isolation is enforced structurally by RLS (same
policies proven in Phases 1–3), but "enforced by construction" is not "verified live," and for a
feature whose entire premise is "per-account view only," that isolation IS the security claim.
It stays 🟡 until a second account runs those gates. The optional `ui-ux-pro-max` second design
pass was also never picked up (not required — the shipped design system is already
functionality-verified).

**What was built:**
- Design system generated from the locked design direction (light-first minimal, cyan/blue
  accent, dense-console SOC variant, dark+light+system) using the `dataviz` skill (already
  available) rather than only `ui-ux-pro-max` (installed this sprint but needs a Claude Code
  restart to load — see Clint's manual steps) — status colors, chrome/ink tokens, and contrast
  checks came from the dataviz skill's validated reference palette and its `validate_palette.js`
  script; the accent (`#0e7490` light / `#22b8d4` dark) was picked and verified against both
  surfaces with that same script (5.22:1 / 7.36:1 against their respective surfaces), not
  eyeballed. `frontend/app/globals.css` — semantic CSS-variable tokens (`--color-surface`,
  `--color-ink`, `--color-accent`, `--color-good/warning/serious/critical`, etc.) in `:root` +
  `[data-theme="dark"]`, mapped into Tailwind v4's `@theme inline` so `bg-*`/`text-*`/`border-*`
  utilities generate automatically; verified present with real hex values in the compiled CSS
  output, not just assumed from a clean build (Tailwind v4 doesn't error on an unresolved token,
  it just silently drops the utility).
- `frontend/components/theme/ThemeProvider.tsx` + `ThemeToggle.tsx` (D11): light/dark/system,
  all three always visible in a segmented control, `system` reacts live to an OS-level change via
  `matchMedia` while the tab is open.
- `frontend/app/layout.tsx`: nonce'd inline theme-init script in `<head>`, reading the same
  `localStorage` key and fallback logic as `ThemeProvider`'s lazy state initializer so the two
  can never disagree (confirmed against Next 16's own bundled docs,
  `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` — the
  pattern matches this project's implementation exactly). Confirmed live in a dev-server request
  that the script's `nonce` attribute matches the `Content-Security-Policy` header's nonce on the
  same response.
- `frontend/utils/api.ts` (D3): `apiFetch`/`apiJson<T>` + `ApiError`. `UploadPanel.tsx` refactored
  onto it mechanically — every hand-rolled `getToken()`+`fetch()` block replaced, exact original
  per-call-site error-message wording preserved (a shared `describeError()` helper was corrected
  mid-build after it would have started showing response bodies in messages that never showed
  them before — caught by re-reading each original call site's exact format before finalizing,
  not assumed). No JSX/visual changes (D2's scope: this sprint touches UploadPanel only for the
  api-helper refactor).
- `frontend/app/dashboard/layout.tsx` (new, D1): shared nav (Workspace / Sessions / SOC) + theme
  toggle + logout, hosts the `getUser()` auth check once for every route under `/dashboard`
  (dual-guard alongside `proxy.ts`) instead of each page repeating it. `dashboard/page.tsx`
  slimmed accordingly (no longer does its own auth check). Note: `Sessions` links to
  `/dashboard/sessions`, which doesn't exist until Sprint 4.3 — a known, temporary 404 until next
  sprint, not an oversight.
- `frontend/app/dashboard/soc/page.tsx` + `BreakerPanel.tsx` (polls `/status/breakers` —
  originally `/health/circuit-breakers`, renamed same sprint, see the filter-list write-up
  below — every 20s + on window focus; status cards colored via the fixed status palette; Langfuse
  enabled/disabled chip; renders its own fetch-failure state instead of going silently stale) +
  `SecurityEventsFeed.tsx` (initial 50-row select + Supabase Realtime `postgres_changes` INSERT
  subscription, `supabase.realtime.setAuth(token)` before subscribing so Realtime evaluates RLS
  per-subscriber; subscription state — connecting/live/reconnecting/disconnected — always
  rendered, per D4's "a broken feed must be visible" rule).
- `frontend/proxy.ts`: explicit `wss://` variant of the Supabase URL added to `connect-src` (D9)
  — confirmed live in the dev-server CSP header, correctly derived from `NEXT_PUBLIC_SUPABASE_URL`.

**A real side effect found, not a regression:** adding `headers()` to the root layout (needed to
read the CSP nonce for the theme-init script) forces the whole app to dynamic rendering, which
flipped `/` from a statically-generated page to server-rendered-per-request (confirmed in the
build output route list). Harmless today since `/` is just a redirect to `/dashboard`, but this
is the exact tradeoff Next's own CSP docs describe ("all pages must be dynamically rendered" with
nonce-based CSP) and is worth re-examining in Sprint 4.4, once `/` becomes the real public
marketing page where static caching would otherwise matter.

**Real bug found live and fixed, 2026-07-09 (two rounds):** the theme toggle stayed visually
stuck on "System" after a page refresh even when Dark had been explicitly chosen and the actual
colors correctly stayed dark. Root cause: a hydration mismatch — `ThemeProvider`'s `useState`
lazy initializer read `localStorage` fresh on both the server render (`window` undefined, falls
back to `"system"`) and the client's first hydration render (`window` defined, reads the real
stored value); the moment a non-default preference was stored these disagreed, and React left
the *toggle UI's* state stuck on the server's guess. The actual rendered colors were never
affected, since those come from the separate inline script in `layout.tsx`, which mutates
`data-theme` directly and sits entirely outside React's hydration reconciliation.

Round 1 fixed the stuck state by starting both the server and the client's first render from an
identical fixed default and correcting to the real preference client-only inside a `useEffect`
after mount. That closed the bug but left a live-reported side effect: the toggle would briefly
flash "System" before snapping to the real choice on every refresh. Round 2 removed the flash:
`layout.tsx`'s inline script (which already runs before paint to set `data-theme` for the
colors) now also stamps the raw preference onto `<html data-theme-pref>`; `ThemeProvider`'s
lazy initializers read that attribute back on the client's first render instead of correcting
after mount, so the toggle paints correctly highlighted immediately. This reintroduces a
same-render hydration mismatch against the server's static markup by design — `ThemeToggle.tsx`
marks the affected buttons `suppressHydrationWarning`, React's sanctioned escape hatch for
exactly this client-only-UI case (the same pattern the `next-themes` library uses). `npm run
build` clean after both rounds.

**Real bug found live, root-caused against the actual filter lists, and fixed:** the breaker
panel showed "Breaker health unavailable: Failed to fetch" live. Backend investigation
(`app/middleware/auth.py`, the CORS config in `main.py`, the route itself) found nothing
route-specific — every other endpoint on the same origin worked. The browser Console showed the
real reason: `net::ERR_BLOCKED_BY_CLIENT` on the `/health/circuit-breakers` request specifically,
with 0 bytes transferred in ~1ms — a request cancelled by the browser itself before it ever
reached the network. It reproduced under two independent blockers (Brave's default Shields, then
a separate extension in a normal Chrome profile) while working fine in Incognito with zero code
change — a shared-filter-list signal, not a one-off extension quirk. An early draft of this entry
called that "not an app bug, tell visitors to disable their extension"; that was wrong and got
corrected — Brave ships blocking on by default, so this would silently break the SOC panel for a
meaningful share of real visitors to a public demo.

Verified against the real lists, not guessed: downloading EasyList, EasyPrivacy, and both uBlock
Origin filter sets and searching them found the exact rule — **EasyPrivacy contains
`||onrender.com/health`**, which blocks any browser request to a `/health*` path on *any* app
hosted on Render (someone presumably added it because a tracking service hosted there exposed a
`/health` endpoint). EasyPrivacy ships enabled by default in Brave Shields, uBlock Origin, and
most privacy extensions, so the block applies to all of them at once. Fix: renamed the endpoint
`/health/circuit-breakers` → `/status/breakers` (backend route + `BreakerPanel.tsx` + docs); the
replacement path was checked against all four downloaded lists and matches nothing. The bare
`/health` endpoint keeps its name — it's only called server-to-server (Render's own checks),
where browser filter lists don't exist. No browser-side workaround needed from any visitor.

**Added, same session: browser/OS on each security event.** Clint asked, live-testing the SOC
page, whether the event detail was thin for a "SOC" dashboard — no IP, no browser, no way to
tell what triggered a flagged query beyond the query text itself. Fair question. `security_events`
rows previously stored only `event_type`, `source`, `detail` (first 300 chars), `user_id`, and a
timestamp. Migration `010_security_event_user_agent.sql` adds a `user_agent` column. All four
write sites now capture it: `check_query()`'s query-injection block (`injection_guard.py`, now
takes `user_agent` as a parameter, threaded from `/research`'s request headers),
`vector_shadow_quarantined` at upload time (`main.py`), `content_as_instruction` in the
synthesizer's chunk scan, and `web_content_as_instruction` in Web Scout — the latter two read it
off `ResearchState["user_agent"]`, set once in `/research` and passed straight through
`research_graph.ainvoke`. `SecurityEventsFeed.tsx` selects and renders it (raw string, truncated,
same treatment as `detail`). No UA-parsing library — raw string is enough, adding one would be
over-engineering a cosmetic display concern.

IP address and a genuinely tamper-evident (service-key) write path were deliberately NOT added
here — they're still Phase 4b, as the original plan scoped: the party being logged currently
writes these rows with their own login token (migration 004's INTEGRITY CAVEAT), so IP capture
alone wouldn't be trustworthy forensic data, just data that looks more forensic than it is.
User-Agent doesn't have that problem — it's contextual, not evidentiary — which is why it moved
now and IP didn't.

**Verify live (manual steps, Clint's):**
1. `git push` (Sprint 4.2's frontend files, including this fix) — Vercel redeploys.
2. Log in, confirm the theme toggle (Light/Dark/System) actually changes the page, persists
   across a reload, and "System" follows your OS setting live if you change it while the tab is open.
3. Open `/dashboard/soc` — confirm breaker cards render with real data (not stuck on "Loading"),
   colors match state (green closed / amber half_open / red open), and the Langfuse chip shows
   correctly. Do this in a normal browser window WITH your usual extensions / Brave Shields on —
   that's the regression check for the `/status/breakers` rename (the old `/health/*` path was
   blocked by EasyPrivacy, see write-up above). Trigger a query that gets blocked (a known
   injection payload) and confirm the security event appears in the feed **live**, without a
   page reload — this is GATE-20 from `docs/ADVERSARIAL-TESTS.md`, now actually testable. Also
   confirm the new event row shows a browser/OS line under the detail text (migration 010 — paste
   it into the Supabase SQL editor first if you haven't).
4. DevTools console: confirm no CSP violation errors (the `wss://` connect-src entry is what this
   check verifies).
5. Optional: restart Claude Code so the `ui-ux-pro-max` plugin (installed but not yet loaded this
   session) is available for a second design-system pass if you want one — not required, the
   design system already shipped via the `dataviz` skill + manual synthesis.

---

### Sprint 4.3 — Sessions, timeline, report UX, cancel

**Status:** 🟡 Code-complete 2026-07-09, not yet live-verified. `npm run build` clean, backend
`py_compile` clean, new Tailwind utility classes confirmed resolved in the compiled CSS (same
discipline as Sprint 4.2 — a clean build does not by itself prove a class survived). No test
credentials in this environment, so nothing below has been clicked through by hand yet.

**What was built:**
- `backend/main.py` — cancel support (D15). Both `/research` and `/collections/{id}/documents`
  gained an `except asyncio.CancelledError:` clause. This needed its own clause because
  `CancelledError` is a `BaseException` in Python 3.8+, not an `Exception` — the existing
  `except Exception:` blocks in both handlers never catch it, so before this change a client
  disconnect (cancel button, closed tab, navigated away) left the session silently stuck at
  `status: "running"` forever and left any already-uploaded document stuck at `"processing"`.
  On research cancel: `_mark_session_error()` (renamed conceptually, still the same function —
  now takes a `status` parameter, defaulting to `"error"` so every existing call site is
  unchanged) is called with `status="cancelled"`, a distinct value from `"error"` so a
  user-initiated stop never reads as a system failure on the sessions list. On upload cancel:
  `_mark_document_failed()` runs (reuses `"failed"`, no new document status), **and** a new
  `_delete_partial_chunks()` helper deletes any `document_chunks` rows already embedded before
  the cancel landed — this turned out to be load-bearing, not just tidiness: `match_document_chunks`
  (the vector-search RPC, `004_security_and_trust.sql`) has no `documents.status` filter, so a
  half-embedded "failed" document's chunks would otherwise still be fully retrievable in search.
  Every except-clause re-raises after cleanup — swallowing `CancelledError` would leave the ASGI
  server's own cancellation bookkeeping in an inconsistent state.
  **Honest caveat, stated per the plan's own instruction:** this all assumes Starlette/uvicorn
  actually deliver `CancelledError` into the running handler coroutine when the client
  disconnects. That's the standard behavior for this stack, but it was never verified against
  *this* app before today, and the plan explicitly flagged it as "verify during build, not
  assumed." The code is correct regardless of the answer; whether it actually fires is a live
  test (see "Verify live" below), not something provable by reading source.
- `frontend/utils/report.ts` — `splitReport()` (D6, pure function). Walks whichever
  `## Answer` / `## Sources` / `## Confidence` headings are actually present in a
  `research_sessions.report` string, rather than assuming a fixed order — `reporter.py`'s
  banner position changed once already (Sprint 4.1, D6), and this tolerates both the old and
  new position on historical stored reports, zero backend/migration involved. Also derives a
  `confidenceLevel` (`high`/`low`/`unassessed`) from the Confidence section's own text for
  `ConfidenceBadge.tsx` to color.
- `frontend/components/ConfidenceBadge.tsx` + `frontend/components/StatusPill.tsx` — new shared
  components, same fixed-status-color convention as `BreakerPanel.tsx` (status colors never
  follow the theme). `StatusPill` adds a `cancelled` state (muted gray) alongside the existing
  `running`/`completed`/`completed_with_fallback`/`error`.
- `frontend/app/dashboard/UploadPanel.tsx` — result-view change (the only touch this component
  gets per D2; the rest of its inline-styled form/list UI is BACKLOG territory, not this
  sprint): the report now renders as answer + banner + `ConfidenceBadge` + a "Show details"
  toggle (Sources/Confidence) + a "View execution trace →" link using the `session_id` `/research`
  already returned (zero backend change). Also: cancel buttons on both the upload and research
  forms (`AbortController`, wired through `api.ts`'s existing `signal` pass-through — D3 already
  anticipated this, no `api.ts` change needed), an unmount effect that aborts both in-flight
  requests so navigating away doesn't leave anything running invisibly, and the in-browser PDF
  preview (decision #11): selecting a file renders it via `<embed>` from a local
  `URL.createObjectURL()` — zero network — with a "Choose a different file" escape hatch; the
  actual upload only fires when the existing "Upload PDF" button is pressed.
  **Honest limitation found while building, not assumed away:** the installed
  `@supabase/storage-js` version's `FileOptions` type has no abort-signal field (checked its
  source directly, not memory) — the Storage-upload leg of an upload cannot actually be killed
  mid-flight. A cancel clicked during that leg is a "soft" cancel: the upload to Storage still
  completes in the background, but the code checks the abort flag before sending the resulting
  `file_path` to the backend, so no document row / embedding job is ever created for it. The
  AbortController does real, verifiable work on the second leg (the backend fetch — PDF
  extraction + embedding, the expensive and cancellable half), which is where `CancelledError`
  handling above actually matters.
- `frontend/app/dashboard/sessions/page.tsx` + `SessionList.tsx` — session history (D1), fetches
  Sprint 4.1's `GET /research`, `StatusPill` per row, "Load more" via `offset` (no new backend
  endpoint needed).
- `frontend/app/dashboard/sessions/[id]/page.tsx` + `SessionDetail.tsx` + `ExecutionTimeline.tsx`
  — the Debug Diary's first visual layer. Fetches `/research/{id}` and `/research/{id}/trace` in
  parallel; either 404ing (RLS makes "not owned" and "doesn't exist" indistinguishable) shows a
  plain "Session not found," never which. Polls every 4s **only** while `status === "running"`
  (D4) — a finished session's page goes idle instead of polling forever. `ExecutionTimeline`
  (D10): no chart library, plain CSS bars per step scaled to that run's own max latency (not a
  fixed scale), colored by the same `ok`/`fallback`/`error` vocabulary `step_writer.py` already
  writes. The report section below the timeline reuses the same `splitReport` + `ConfidenceBadge`
  treatment as `UploadPanel.tsx`'s live result view, so a historical session and a just-finished
  query read identically.

**Verify live (manual steps, Clint's):**
1. `git push` — Render + Vercel both redeploy.
2. **Cancel, the load-bearing test:** start a research query, click Cancel mid-run. Confirm (a)
   the UI shows "Research cancelled," not an error, and (b) the session's row in `/dashboard/sessions`
   shows `Cancelled`, not stuck on `Running` forever — this is the actual proof that Starlette/uvicorn
   deliver the disconnect as `asyncio.CancelledError` in this app, not an assumption. Repeat for an
   upload: start uploading a document, click Cancel mid-processing, confirm the document does NOT
   appear as a normal ready document, and that a query against that collection finds nothing from
   it (proof the partial-chunk delete worked, not just that the row got marked failed).
3. Upload preview: pick a PDF, confirm it actually renders in the embedded viewer before clicking
   Upload; try "Choose a different file" and confirm it swaps cleanly with no leftover preview.
4. Ask a normal question, confirm the new result view: answer, confidence badge with a sensible
   color, "Show details" reveals Sources + the full Confidence text, "View execution trace →"
   opens the session's timeline page with all 6 agents shown with real latencies.
5. Open `/dashboard/sessions`, confirm past sessions list with correct statuses and dates; open
   one, confirm the trace + report render the same way as a live result.
6. GATE-21: try `/dashboard/sessions/<some-other-account's-session-id>` — confirm it shows
   "Session not found," not a leak. (Needs a second test account for a real foreign id; visiting
   a syntactically-valid-but-nonexistent uuid is a partial substitute.)

---

### Sprint 4.4 — Public landing + Google sign-in + usage limits

**Status:** ⏳ Not started.

Planned: `/` becomes a public marketing page (today it force-redirects to `/dashboard`); Google
OAuth via Supabase Auth; new `usage_limits` table, owner-editable in Supabase Studio, visible in
the UI as a usage meter. Closes BACKLOG Item 3.

---

### Sprint 4.5 — Project Q&A chatbot + rate limiting

**Status:** ⏳ Not started. Own threat-model planning pass required before build — a public,
unauthenticated LLM endpoint is a new attack surface and a new cost surface. Locked shape so far:
Gemini via raw `httpx` REST from a separate Google Cloud project (quota isolation), grounded on a
static curated project summary (not live document retrieval), per-IP sliding-window limit + a
persisted global daily cap, regex + trust-level injection posture reused from the existing guard.

---

### Sprint 4.6 — Multimodal PDF ingestion + Report Generation

**Status:** ⏳ Not started. Own threat-model planning pass required before build — image-borne
prompt injection is a currently-uncovered channel (PyMuPDF is text-only today; see BACKLOG
Item 4). Two locked shapes so far: vision captioning via Groq Llama 4 Scout with captions scanned
by the same regex + a new `image_derived` trust level; a separate "Generate report" flow with a
domain-tailored template, preview-before-download, and `.docx`/PDF export, metered by
`usage_limits`.

---

## Phase 4b — parking lot, not scheduled

Everything in `docs/BLUEPRINT.md`'s original Phase 4 sketch that needs an admin role or a table
that doesn't exist: world map, global cross-user request feed (`request_log`), IP intelligence
panel, `admin_settings` maintenance kill-switch, `circuit_breaker_log` history table, an AI
session summarizer, and the `ip-api.com` breaker (nothing calls that service until this lands).
Full reasoning for the split: `docs/ADR-018.md` Part 3.

---

## Related documents

- `docs/ADR-018.md` — Sprint 4.1's three decisions in full: the reasoning-JSON helper, the HF
  embedding breaker, and the Phase 4 / 4b split.
- `docs/ROADMAP.md` — where Phase 4 sits in the overall project plan.
- `docs/ADVERSARIAL-TESTS.md` — GATE-18 through GATE-22 (Sprint 4.1) and onward per sprint.
- `docs/BACKLOG.md` — Items 3 and 6, both graduated into Phase 4 this sprint.
- `CONTINUITY.md` (repo root, gitignored) — the private working log between sessions.
