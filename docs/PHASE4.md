# ARGUS — Phase 4: Dashboard, Sessions, Public Landing, Chatbot, Multimodal

**Status:** ✅ Sprint 4.1 live-verified 2026-07-09. ✅ Sprint 4.2 functionality live-verified
2026-07-09 — with its cross-user *isolation* gates (GATE-18/19/20/21) still 🟡, pending a second
test account (the SOC page is proven to show your own data, not yet proven to hide others'; see
the Sprint 4.2 section). 🟡 Sprint 4.3 reworked 2026-07-10 after a live test caught six bugs
(the cancel feature was an illusion — see its section); Clint reported all six concerns re-tested
and passing 2026-07-11 (his own testing; the security-isolation gates still want the formal run).
✅ Sprint 4.4 live-verified + CLOSED 2026-07-11 (public landing, Google OAuth, usage limits, the
research-cap bypass fix) after four live review passes. Sprints 4.5–4.6 not started; the committed
presentability pass is the next work item (ROADMAP owner note, 2026-07-11). Every checkbox below is ⏳ until its sprint is code-complete (🟡) and then
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

**Status:** 🟡 Reworked TWICE (2026-07-10) after live tests; awaiting re-verification.
First cut was code-complete 2026-07-09; Clint live-tested with a second account 2026-07-10 and
found six issues (first list below). The sessions list, execution timeline, per-account isolation
(GATE-18 now passed — the second account saw only its own sessions), report split view, and
confidence badge all worked. The first rework's cancel fix (`request.is_disconnected()` polling)
**also failed live** — see "Rework #2" below for why, and for the design that replaced it. All
known issues are now fixed in code; `npm run build` clean, backend `py_compile` clean, new
Tailwind classes confirmed in compiled CSS. **Nothing re-verified live yet.**

**Rework #2 (2026-07-10, second live test): cancel redesigned around an explicit DB signal.**
The live re-test showed `is_disconnected()` never fires either — uploads still completed after
cancel, research ran to completion with no `cancelled` status ever appearing. Conclusion, now
twice-proven: **the backend cannot observe a client disconnect at all behind Render's proxy**,
which buffers the whole request/response cycle. Any cancel design that depends on detecting the
disconnect (exception-based, polling-based, anything) is dead on this platform. The replacement
puts the cancel signal *in the database*, which the backend can always see:

- **Upload:** the client now generates the document's uuid and sends it in the upload body
  (`document_id`, optional — old callers unaffected). The backend creates the document row
  FIRST (so cancel has a target from the first moment), and its embedding loop polls "does my
  row still exist?" between batches. The Cancel button simply calls the existing
  `DELETE /documents/{id}` — row vanishes, loop notices, stops; chunks are gone via the FK
  cascade and any straggler insert fails on the FK. End state after cancel: no document, no
  chunks, nothing to double on re-upload. Early failures (bad storage fetch, not a PDF) now
  delete the row instead of leaving a `failed` husk; failures mid-embedding still mark `failed`
  (GATE-22's expectation, preserved).
- **Research:** the client generates the session uuid too (`session_id` in the POST body) —
  necessary because `/research` is synchronous, so without this the client only learns the id
  when the response returns, exactly too late to cancel. New endpoint
  `POST /research/{id}/cancel` flips the session row to `cancelled`
  (`&status=eq.running` — only a running session can be cancelled). The `traced()` wrapper in
  `step_writer.py` checks that flag before every agent runs and raises `ResearchCancelled`,
  which `/research` catches and returns quietly — the pipeline actually stops mid-run, within
  one agent boundary of the click. The final "completed" write is also filtered to
  `status=eq.running`, so a finished report can never overwrite a cancellation, even in a race.
  Cost: one small status read per agent (~6–9 per query) — the price of cancellation that
  actually works on this platform.
- **Navigate-away:** the panel's unmount hook fires the same two DB-signal calls with
  `keepalive: true` (survives the page going away), then aborts the local fetches.
- **Honest residual, stated up front:** every cancel signal is sent three times (immediately,
  +5s, +30s) to cover the cold-start race — Render's proxy holds a request while the free-tier
  dyno wakes (30–60s), and until the backend runs, the row the cancel targets doesn't exist yet.
  A cold start longer than the last retry can still outrun the cancel; in that rare case the
  work completes normally and the resulting doc/session is simply deleted from its list
  afterward. No design on a synchronous transport closes this window completely — the async-jobs
  rearchitecture (deferred, BLUEPRINT) is the real fix for that tail case.

**Also in rework #2 (Clint's 2026-07-10 feedback round):**
- **Double login, structural fix:** intermittent first-login `?reason=idle` bounces. Root cause
  never reliably reproducible ("random" per testing), so instead of a fourth guess at where the
  stale `last_active` cookie leaks from, the fix makes the false positive structurally
  impossible: new `/auth/activity` route (server-side, the cookie is httpOnly) stamps
  `last_active = now` the moment sign-in succeeds — `LoginForm` calls it before navigating. A
  fresh login now starts with a fresh timestamp no matter what any older cookie said. The login
  page also finally explains an idle signout ("You were signed out after 30 minutes...") instead
  of a bare `?reason=idle` URL.
- **Session history delete:** new `DELETE /research/{id}` (RLS-scoped, 404-indistinguishable,
  cascades to `execution_steps` via 008's FK) + a Delete button per row in the sessions list.
  Auto-expiry after N days noted as a future owner item (needs pg_cron — not built, not claimed).
- **App shell (start of the IA Clint asked for):** `/dashboard` is now a real overview — counts
  (collections/documents/sessions, read via the Supabase server client so RLS scopes them with
  zero backend round-trip), a numbered how-it-works with a "Get started →" CTA for empty
  accounts, latest-session card, and the free-tier cold-start note. The workspace
  (collections/upload/query) moved to `/dashboard/workspace` with its own nav tab. The ARGUS
  wordmark links back to the dashboard. The theme toggle and logout moved into a new
  profile-circle dropdown (`ProfileMenu.tsx`) with About/Privacy links (pointing at the public
  repo docs that actually exist) and a deliberately-disabled "Settings (coming soon)" — no dead
  links, the docs-honesty rule applied to UI.
- **SOC explainer:** a plain-words "What is this page?" card for normal users — what breakers
  are, why seeing blocked events means the defense is working.
- **Sizing pass:** collections list (max-h-64) and documents list (max-h-56) scroll internally
  instead of stretching the page; the PDF preview is a fixed 320px viewer on every breakpoint
  (the PDF scrolls inside it); the query textarea caps at 120px then scrolls internally.
  **Enter now submits the query** (Shift+Enter for a newline), matching the chat convention.
- The public landing page and the broader visual polish stay Sprint 4.4 — explicitly not
  half-built here.

**Live test 2026-07-10 (first round) — six findings, root causes, and fixes:**

**Live test 2026-07-10 — six findings, root causes, and fixes:**
1. **Cancel was an illusion (the big one).** Root cause confirmed against the deployed stack
   (uvicorn 0.48, single worker): uvicorn does NOT raise `CancelledError` into a running handler
   when the client disconnects — it only queues an ASGI `http.disconnect` that the app must
   actively poll via `request.is_disconnected()`. So the `except asyncio.CancelledError` clauses
   from the first cut almost never fired; a "cancelled" upload ran to completion (proof: cancel →
   leave collection → return → the PDF was there anyway), and re-uploading then **doubled** the
   document. Same for research: it kept running in the background after navigating away.
   **[Fix attempt #2, SUPERSEDED same day → see "Rework #2" above]** cooperative cancellation via
   a `request.is_disconnected()` poll. The write-up here flagged, verbatim, that it "STILL rests
   on `is_disconnected()` firing correctly on Render, which is exactly the class of assumption
   that just burned us" — and the live re-test proved it doesn't fire either (Render's proxy
   buffers the request cycle; the backend can never observe a client abort in any form). The
   full-delete cleanup helper (`_delete_document_fully`) survives into the final design; the
   disconnect polling does not. Current mechanism: explicit DB-signal cancel — Rework #2 above.
2. **PDF preview showed nothing (CSP).** The `<embed>`/blob preview was blocked by
   `object-src 'none'` (in place since ADR-008). **Fix:** switched the preview to an `<iframe>`
   and added `frame-src 'self' blob:` to the CSP in `proxy.ts`; `object-src 'none'` stays intact
   (an iframe is governed by frame-src), so the plugin/Flash hardening is unchanged.
3. **Phantom "ready" document that failed every query.** A doc left behind by the illusory
   cancel showed `ready` but returned "AI service unavailable" on query. Largely a compound of
   #1 (phantom doc) and #4 (see below); the full-delete-on-cancel fix removes the phantom, and #4
   fixes the misleading error.
4. **Retry discarded a good answer.** Found in the trace: a first synthesizer pass produced a real
   2040-char answer, the critic flagged low confidence and triggered a retry, and the retry's Groq
   call hit a transient failure whose fallback message ("AI service unavailable") **overwrote the
   good first answer** — the retry made the result strictly worse. **Fix:** `synthesizer.py` now
   captures the previous pass's answer and, if this attempt's Groq call fails, keeps the previous
   good answer instead of clobbering it with the fallback. A flaky retry can no longer do worse
   than not retrying. (Note: if Groq is genuinely down/rate-limited for the whole query, "AI
   unavailable" is still correct — this only stops a *transient retry blip* from destroying a
   result that already succeeded.)
5. **Query box ran off the container.** It was a fixed-width single-line `<input>` at 70% width.
   **Fix:** it's now an auto-growing `<textarea>` (wraps to the next line, grows to ~200px then
   scrolls) in a fluid, mobile-first layout.
6. **Layout not responsive / preview placement.** The whole `UploadPanel` was inline-styled with
   hardcoded dark colors that ignored the theme and a fixed oversized block. **Fix:** rebuilt on
   the design tokens (themed light/dark) with a mobile-first responsive layout — the PDF preview
   now sits side-by-side to the right of the upload controls on wide screens and stacks below on
   phone/tablet. Used the `ui-ux-pro-max` skill (now installed) plus the existing token system.

Also addressed from the same feedback: the dashboard greeting now prefers a real name
(`user_metadata.full_name`/`name`) and falls back to email — password accounts still show email,
Google OAuth (Sprint 4.4) will populate the name with no further change. **Report Generation with
format** stays Sprint 4.6 (its own planning pass, D17) — noted, not built.

**Original 2026-07-09 build notes (some superseded by the rework above — kept for the trail):**

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
  [SUPERSEDED 2026-07-10 → now `_delete_document_fully`, removing the row entirely, see finding #1
  above] `_mark_document_failed()` runs (reuses `"failed"`, no new document status), **and** a new
  `_delete_partial_chunks()` helper deletes any `document_chunks` rows already embedded before
  the cancel landed — this turned out to be load-bearing, not just tidiness: `match_document_chunks`
  (the vector-search RPC, `004_security_and_trust.sql`) has no `documents.status` filter, so a
  half-embedded "failed" document's chunks would otherwise still be fully retrievable in search.
  Every except-clause re-raises after cleanup — swallowing `CancelledError` would leave the ASGI
  server's own cancellation bookkeeping in an inconsistent state.
  **Honest caveat, stated per the plan's own instruction [PROVED FALSE 2026-07-10 → see finding
  #1; uvicorn does NOT deliver CancelledError on disconnect, the mechanism was reworked to
  cooperative `is_disconnected()` polling]:** this all assumes Starlette/uvicorn actually deliver
  `CancelledError` into the running handler coroutine when the client disconnects. That's the
  standard behavior for this stack, but it was never verified against *this* app before today, and
  the plan explicitly flagged it as "verify during build, not assumed." The code is correct
  regardless of the answer; whether it actually fires is a live test (see "Verify live" below),
  not something provable by reading source.
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
  preview (decision #11): selecting a file renders it [SUPERSEDED 2026-07-10 → now `<iframe>` +
  CSP `frame-src blob:`, see finding #2; the `<embed>` was blocked by `object-src 'none'`] via
  `<embed>` from a local `URL.createObjectURL()` — zero network — with a "Choose a different file"
  escape hatch; the actual upload only fires when the existing "Upload PDF" button is pressed.
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

**Verify live (manual steps, Clint's) — the rework #2 RE-test, 2026-07-10:**
1. `git push` — Render + Vercel both redeploy. (Cancel spans backend + frontend; wait for Render.)
2. **Cancel, THE load-bearing test (third design — prove it, don't trust it):**
   - Research: start a query, click Cancel mid-run. The session in `/dashboard/sessions` must
     read `Cancelled` (the Cancel button now writes that status directly, so it should appear
     immediately), AND the execution trace for that session must show the pipeline stopping
     partway (fewer than the full 6+ agent steps) — that second part is the proof the work
     actually stopped, not just the label changing. No report on the session afterward.
   - Upload: start uploading, click Cancel mid-processing. The document must NOT appear in the
     Documents list at all (refresh to confirm — no phantom, no `failed` husk), and re-uploading
     the same file must produce exactly ONE document. Query the collection: nothing from the
     cancelled upload is retrievable.
   - Navigate-away variant: start a research query, immediately click over to SOC. Come back —
     the session must end up `Cancelled`, not `Completed`.
   - Fallback if this STILL fails: there is no fourth cancel design to try on this transport —
     the remaining option is the deferred async-jobs rearchitecture (BLUEPRINT), and we'd hide
     the button honestly rather than ship it broken again.
3. Double login: log out, log back in several times (and once after 30+ min away). No first-login
   `?reason=idle` bounce should occur — sign-in now stamps the activity cookie before any request
   reaches the idle check. The idle message itself, when legitimate, now shows a plain-words
   banner on the login page.
4. New shell: ARGUS wordmark returns to the dashboard; the dashboard shows counts + Get Started;
   Workspace is its own tab; the profile circle opens a menu (theme inside it, About/Privacy repo
   links, Settings greyed "coming soon", Log out).
5. Preview renders in its fixed 320px viewer (right of the controls on wide, stacked on narrow);
   collections/documents lists scroll internally past their caps instead of stretching the page;
   the query box wraps and stops growing at ~120px; **Enter submits** (Shift+Enter = newline).
6. Sessions: Delete removes a session (and its trace — reopen its old URL, expect "Session not
   found"). SOC shows the "What is this page?" explainer.
7. GATE-21 (second account): as B, visit `/dashboard/sessions/<A's session id>` — "Session not
   found," not a leak.

---

### Sprint 4.4 — Public landing + Google sign-in + usage limits

**Status:** ✅ **Live-verified 2026-07-11 (Clint's testing) — Sprint 4.4 CLOSED.** All four live
review passes worked through (public landing, Google OAuth after his URL-config fix, usage limits
with GATE-23 passing, the research-cap bypass fixed via migration 014, plus the ContactModal /
timeline-descriptions / user_profiles-names round). Migrations 011–014 pasted, caps reverted from
test values. GATE-23 ✅ and GATE-24 ✅ recorded in `docs/ADVERSARIAL-TESTS.md`. The build history
below is kept as the sprint's record; the multi-pass findings lists document every live bug found
and fixed along the way.

**Built:**

1. **Public landing page at `/`** (`frontend/app/page.tsx`, was a bare `redirect('/dashboard')`).
   A real marketing/intro page so a recruiter following the repo link no longer hits a login wall:
   sticky header (wordmark, theme toggle, Sign in / Go to dashboard), hero, a "six agents, one
   answer" section describing the real pipeline (orchestrator → web scout → retriever → synthesizer
   → critic → reporter), a "built to be attacked" security section (injection defense, circuit
   breakers, RLS isolation, live SOC console), and an about/contact section. Every claim maps to
   something the code actually does — the project rule that docs never overclaim applies hardest to
   the public page. Styled entirely on the existing Sprint 4.2 design tokens; no new dependency.
   - **Reveal-on-scroll** (`frontend/components/landing/Reveal.tsx` + `.reveal` rules in
     `globals.css`) built to the standing "works on ANY browser" rule: content is VISIBLE by
     default, the client component only *arms* the hidden-then-reveal once JS is confirmed running,
     with a `<noscript>` net and a `prefers-reduced-motion` guard both forcing full visibility. A
     broken or absent script can never leave content hidden. IntersectionObserver (universal
     support), not CSS scroll-driven animations (patchy across browsers).
   - **`proxy.ts`**: `/` is now a public path. A new `isPublicPath()` helper centralizes the
     definition (`/` matched EXACTLY so it can't widen access to a protected route; `/login` and
     `/auth/*` unchanged). Authenticated visitors to `/` are NOT force-redirected — they just see
     "Go to dashboard" (D12). Every `/dashboard/*` route still requires a session (dual guard:
     proxy + per-page `getUser()`), verified by the build still emitting all routes and by the
     idle-timeout logic now also gated behind `isPublicPath`.

2. **Google sign-in (OAuth)** — `@supabase/ssr`'s default PKCE flow.
   - `frontend/app/login/LoginForm.tsx`: a "Continue with Google" button calls
     `signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback } })`,
     plus a `?error=oauth` banner for a failed round-trip. The four-color Google mark is an inline
     SVG (no icon library yet — that lands in the committed presentability pass).
   - `frontend/app/auth/callback/route.ts` (new): exchanges the returned auth code for a session
     via `exchangeCodeForSession`, stamps `last_active` at that moment (same double-login immunity
     the password path gets from `/auth/activity`), and redirects to `/dashboard`. Hardened: an
     open-redirect guard on `?next=` (only same-origin relative paths) and the documented Vercel
     `x-forwarded-host` handling. Confirmed the callback API against live Supabase docs, not memory.
   - CSP unchanged: `signInWithOAuth` is a top-level document navigation to the Supabase authorize
     URL (which 302s to Google), not a `fetch`/XHR, so `connect-src`/`form-action` don't gate it.

3. **Usage limits (D13)** — a public signup surface must not open unmetered free-tier usage.
   - `supabase/migrations/011_usage_limits.sql` (note: **011**, not 010 — 010 is the earlier
     `security_events.user_agent` column). Per-user `usage_limits` row: `max_collections`,
     `max_documents`, `max_research_per_day`. **Trust model**: clients get `SELECT` only (RLS
     own-row) — a user can read their caps but can NEVER raise them from the browser; only the
     `SECURITY DEFINER` signup trigger and the owner (via Studio) write them. New accounts (email
     OR Google) get tight default caps (3 / 15 / 15) via an `auth.users` AFTER INSERT trigger;
     existing accounts are backfilled to an owner/QA tier (100 / 500 / 500) so no current test
     account is capped mid-testing.
   - **Backend enforcement** (`backend/main.py`): `create_collection`, `upload_document`, and
     `research` each count the user's current usage (RLS-scoped) and return a friendly **429** if
     at the cap, before doing any billable work (the research check runs before the injection
     classifier and the agent graph, so an over-limit query spends zero Groq/HF quota). A missing
     `usage_limits` row fails **closed** to the tight defaults, never "unlimited" and never a 500.
   - **Usage meter** (`frontend/app/dashboard/page.tsx`): three labeled bars (collections,
     documents, research-in-last-24h) against the user's caps, read directly via the RLS-scoped
     Supabase server client; bars turn amber at ≥80% and red at the limit. Limits are visible to
     users, per D13.

**Closes BACKLOG Item 3** (Google sign-in was gated on the ADR-013 privacy checklist — answered in
ADR-019). Design + privacy reasoning: `docs/ADR-019.md`. Gates: GATE-23 (limits enforce) and
GATE-24 (public/auth boundary + OAuth round-trip) in `docs/ADVERSARIAL-TESTS.md`, both 🟡 until live.

**Clint's manual steps (all his — prepare, explain, stop):**

**Step 1 — Paste migration 011**
1. Open the Supabase dashboard for the ARGUS project → left sidebar → **SQL Editor**.
2. Click **New query**.
3. Open `supabase/migrations/011_usage_limits.sql` in the repo, copy the whole file.
4. Paste it into the SQL Editor, click **Run**.
5. Confirm it worked: left sidebar → **Table Editor** → you should see a new `usage_limits` table
   with columns `user_id`, `max_collections`, `max_documents`, `max_research_per_day`,
   `updated_at`. It should already have one row per existing user (backfilled by the migration
   itself) with values `100 / 500 / 500`.

**Step 2 — Find your Supabase project's callback URL (needed for step 3)**
1. Supabase dashboard → left sidebar → **Project Settings** (gear icon, bottom of sidebar) →
   **Data API** (or **API** on older dashboards).
2. Copy the **Project URL** at the top — it looks like `https://abcdefghijklmnop.supabase.co`.
3. Your callback URL is that same URL with `/auth/v1/callback` appended:
   `https://abcdefghijklmnop.supabase.co/auth/v1/callback`. Write this down — you'll paste it in
   step 3.

**Step 3 — Google Cloud Console: create OAuth credentials**
1. Go to https://console.cloud.google.com/ and sign in with the Google account you want to own
   this (can be a personal account or a dedicated project account — your call).
2. Top-left, next to the "Google Cloud" logo, click the project dropdown → **New Project**.
   Name it something like `argus-oauth` → **Create**. Wait for it to finish, then make sure the
   dropdown shows this new project selected (not "My First Project" or another old one).
3. Left sidebar (hamburger menu ☰) → **APIs & Services** → **OAuth consent screen**.
4. User Type: choose **External** (unless you have a Google Workspace org and want Internal) →
   **Create**.
5. Fill in the required fields only: **App name** = `ARGUS`, **User support email** = your email,
   **Developer contact email** = your email. Leave everything else blank/default → **Save and
   Continue** through the Scopes and Test users screens (no changes needed on either) → **Back to
   Dashboard**.
6. Left sidebar → **APIs & Services** → **Credentials**.
7. Click **+ Create Credentials** (top of page) → **OAuth client ID**.
8. **Application type**: select **Web application**.
9. **Name**: `ARGUS Supabase` (or anything — it's just a label for you).
10. Under **Authorized redirect URIs**, click **+ Add URI**, paste the callback URL you copied in
    Step 2 (`https://<your-project-ref>.supabase.co/auth/v1/callback`).
11. Click **Create**. A popup shows your **Client ID** and **Client Secret** — copy both somewhere
    safe (you'll paste them in the next step). You can always come back to **Credentials** to see
    the Client ID again, but the Secret is only fully shown once — if you lose it, click the
    credential's edit (pencil) icon → **Add Secret** to generate a new one.

**Step 4 — Supabase dashboard: enable the Google provider**
1. Supabase dashboard → left sidebar → **Authentication** → **Providers**.
2. Find **Google** in the provider list, click it to expand.
3. Toggle **Enable Sign in with Google** on.
4. Paste the **Client ID** from Step 3 into the "Client ID" field.
5. Paste the **Client Secret** from Step 3 into the "Client Secret" field.
6. Click **Save**.

**Step 5 — Supabase dashboard: allow your app's URLs**
1. Still in **Authentication**, click **URL Configuration** in the left sub-menu.
2. **Site URL**: set this to your production Vercel URL (e.g. `https://argus.vercel.app` — use
   whatever your actual production domain is).
3. **Redirect URLs**: click **Add URL**, add each of these on its own line:
   - `https://<your-vercel-production-domain>/auth/callback`
   - `http://localhost:3000/auth/callback` (so it also works when you test locally)
4. Click **Save**.

**Step 6 — Deploy and verify**
1. `git push` from the repo (Render + Vercel both redeploy automatically).
2. Wait for both deploys to finish (Vercel dashboard shows "Ready"; Render dashboard shows
   "Live").
3. Go to your production URL, land on `/login`, click **Continue with Google**.
4. **PASS** looks like: Google's account picker appears → after choosing an account, you land back
   on `/dashboard`, signed in. **FAIL** looks like: you land back on `/login?error=oauth`, or a
   Google error page — if either happens, re-check the redirect URI in Step 3.10 and the Redirect
   URLs in Step 5.3 match exactly (no trailing slash mismatches).
5. Run GATE-23 and GATE-24 from `docs/ADVERSARIAL-TESTS.md` and record the results there.

**Step 7 — optional, to deliberately trigger GATE-23's 429 for testing**
1. Supabase dashboard → **Table Editor** → `usage_limits`.
2. Find your test user's row (match by `user_id` — cross-reference **Authentication** → **Users**
   to find the id for a given email).
3. Click into the row, change `max_research_per_day` to `1`, save.
4. Run one research query in the app (succeeds), then a second (should now fail with the friendly
   429 message).
5. Change `max_research_per_day` back to a normal value (e.g. `500`), save. Run one more query —
   it should succeed immediately, no redeploy needed. That's the proof the limit is read live from
   the database on every request.

**Still not built this sprint (deliberate):** the broader **presentability pass** (icon library,
component polish, real Settings page, empty/loading states) is a committed follow-up right after
this landing establishes the visual language — see ROADMAP owner notes, 2026-07-11.

**Live-test findings, first pass (Clint, 2026-07-11) — eight items, all addressed same day:**

1. **Copy claimed "thesis project"** — wrong, he has graduated. Removed; the About section now says
   portfolio project only. Em dashes also swept out of all landing copy (humanizer pass).
2. **"Built to be attacked" header** read as an open invitation to pen-test the deployment. Renamed
   to "Careful with your documents" with a calm intro; same four defense cards, de-dramatized.
3. **Stale auth CTA**: after logging out, a browser-cached copy of the landing still showed
   "Go to dashboard" until a manual refresh. Root cause: the page is server-rendered with the
   visitor's auth state, and back/restore navigation can serve a copy rendered before the
   login/logout. Fix: new `frontend/components/landing/AuthLink.tsx` — takes the server's answer as
   the initial state, re-checks the real session client-side on mount (local cookie read, no
   network) and on `pageshow` restore, and corrects the label. Used for both the header button and
   the hero CTA.
4. **Login page was a dead end** — no way back to the landing. Added a "← Back to ARGUS" link above
   the form.
5. **LinkedIn** added to the About buttons (`linkedin.com/in/clint-branwel-p-b356a1364`).
6. **Footer buttons were redundant** with the About section's directly above. Footer slimmed to the
   wordmark + a one-line descriptor, no repeated links.
7. **Positioning corrected (the big one):** the headline story is ARGUS turning messy, unorganized
   documents into clear, usable output — not security. Hero rewritten ("Messy documents in. Clear
   answers out."); security demoted to a supporting section. The landing still only claims what
   works today (Q&A with sources + confidence); the full report-generation-with-figures story stays
   OFF the landing until Sprint 4.6 ships it.
8. **Google sign-in failed** with `{"error":"requested path is invalid"}`. **Config, not code**: the
   failing request URL was `https://<ref>.supabase.co/argus-nine-ivory.vercel.app?code=...` — the
   Vercel domain glued onto Supabase's own host as a *path*, which is what Supabase does when a URL
   in Authentication → URL Configuration was saved **without the `https://` scheme**. It also fell
   back to the Site URL root instead of `/auth/callback`, meaning the callback URL wasn't accepted
   from the Redirect URLs list either. Fix (Clint, dashboard): re-enter **Site URL** as
   `https://argus-nine-ivory.vercel.app` (scheme included), and make sure **Redirect URLs** contains
   `https://argus-nine-ivory.vercel.app/auth/callback` exactly (no missing scheme, no trailing
   slash). Then retry the sign-in fresh (the old `?code=` is single-use and already spent).
   **Resolved same day: Clint fixed the config and the OAuth round-trip passed live** — see GATE-24.

**Live-test findings, second pass (Clint, 2026-07-11) — ten items:**

1. **Google sign-in works** after the URL-config fix (his words: "That was my blunder"). GATE-24's
   OAuth half recorded as ✅ live; two small confirmations still open (usage_limits row for the
   Google account, explicit signed-out route sweep).
2. **"What is user_profiles for?"** — honest answer: Phase 1 scaffolding (migration 001) that
   nothing ever wrote to; account records actually live in `auth.users`, which Studio's Table
   Editor doesn't show. Fixed with **migration 012**: a signup trigger now writes each account's
   email + display name into `user_profiles` (works for email/password AND Google, pulling the
   OAuth `full_name`), plus a backfill for every existing account.
3. **"Which uuid owns what?"** — same fix: after 012, `user_profiles` is the human-readable
   uuid→person reference when browsing collections/documents/sessions in Studio.
4. **"Get in touch" is now a popup** (`ContactModal.tsx`): email with Copy + Open-mail buttons, and
   LinkedIn. The **n8n automated-email form** (same as the portfolio site) is noted as a real,
   named use case in ROADMAP — blocked on Clint's n8n webhook URL + a CSP `connect-src` entry for
   its domain; not built until he provides the URL, and no fake form ships in the meantime.
5. **Clickable header nav** added to the landing (How it works / Security / Contact), smooth-scroll
   anchors with a reduced-motion guard, same pattern as his portfolio.
6. **Sessions timeline now explains each agent**: a plain-words description line under every step
   (`ExecutionTimeline.tsx` `AGENT_DESCRIPTIONS`), so a user reading a trace doesn't need to have
   memorized the landing page.
7. **Login page signup disclaimer** added: no email/password signup exists; "Continue with Google"
   creates the account automatically; email/password signup named as a future feature.
8. **Login page is otherwise bare** — acknowledged, deliberately deferred to the committed
   presentability pass (ROADMAP owner note updated to name the login page explicitly).
9. **© 2026** added to the landing footer.
10. **Richer scroll interactivity/animation** — deferred to the presentability pass, noted there.

**New manual step from this pass:** paste `supabase/migrations/012_user_profiles_signup.sql` in
the SQL editor (same flow as migration 011's Step 1). Verify: Table Editor → `user_profiles` now
shows one row per account with `email` filled in (the Google account's `display_name` should carry
the Google profile name).

**Future notes from the same review (ROADMAP owner notes):** a LinkedIn post draft to present the
app once Phase 4 closes; a logo design for ARGUS (separate design-agent task).

**Live-test findings, third pass (Clint, 2026-07-11 — GATE-23 run):**

1. **GATE-23 ✅ PASS live**: caps set to 5 in Studio, sixth research query returned the friendly
   429, raising the cap unblocked the next query with no redeploy. Recorded in ADVERSARIAL-TESTS.
2. **Raw JSON leaked into the UI**: the 429 rendered as `Research query failed (429): {"detail":
   "..."}` — syntax and all. Fixed in one place: `describeError` (UploadPanel) now parses the
   FastAPI `detail` sentence out of every backend error and shows only that; falls back to
   "prefix (status)." when the body isn't JSON. The backend messages were also shortened
   ("Free-tier limit reached: 5 research queries per day. Try again tomorrow." — the
   "contact the owner" tail dropped).
3. **Workspace usage strip** (finding: caps were only visible on the dashboard): a compact
   "Collections 3/5 · Documents 2/5 · Research today 1/5" line at the top of the workspace,
   fed by the user's own RLS-scoped `usage_limits` row + two head-count queries, refetched after
   every mutation (upload, deletes, research) rather than delta-tracked so it can't drift. Turns
   critical-red at a cap so the 429 is never a surprise.
4. **Duplicate-collection bug**: clicking "Create collection" repeatedly created one collection
   per click (no in-flight guard), and identical names were accepted. Fixed both layers: the
   button disables while its request is in flight ("Creating…"), and the backend now returns a
   friendly **409** ("You already have a collection named X") on a duplicate name for the same
   user. Honest note: no DB unique constraint yet, so two truly simultaneous requests could still
   race past the check — the disabled button covers the realistic case; a unique index would need
   Clint to clean up the existing `test1` duplicates first, so it's noted rather than shipped.
5. **Subscription question answered** (see ROADMAP owner note): per-user raises are already
   possible today — every `usage_limits` row is one user; the earlier blanket UPDATE was blanket
   only because the test asked for it. The uuid→person readability gap is exactly what migration
   012 fixes (paste it). A simulated subscription tier that auto-raises limits monthly is future
   scope (Phase 4b territory: needs roles/admin machinery), parked as an owner note, explicitly
   NOT built now — and locked off by design since this isn't a profit-first project.

**Live-test findings, fourth pass (Clint, 2026-07-11):**

1. **`usage_limits` has no name/email column** — correct, and it shouldn't: it stores only caps.
   Migration **013** adds a read-only `usage_limits_readable` VIEW that joins `user_profiles`, so
   browsing it in Studio shows email/display_name next to each row (edit the real `usage_limits`
   table; browse the view to find whose row it is). `security_invoker` so it respects RLS.
2. **Research-cap bypass (real bug, fixed)**: a user at their daily research cap could delete a
   collection to wipe the `research_sessions` rows the count was based on (they cascade-delete with
   the collection), resetting the count and defeating the rate limit. Fixed with migration **014**:
   a `usage_events` append-only table (no collection FK, no user-delete path) is now the source of
   truth for the daily count; the backend logs one event per real run and counts events, not
   sessions. Both usage meters (dashboard + workspace strip) switched to `usage_events` to stay
   consistent with the cap. **Collections/documents were NOT bypassable** — they're ownership
   quotas (max live rows owned, already per-user), where delete-and-recreate keeps you at or under
   the cap; only the per-day research RATE limit had deletable evidence.
3. **"Reset usage as a reward" feature** — recorded as a Phase 4b owner note with the key design
   insight (research resets via `usage_events` clear/credit; collections/documents have no counter
   to reset, so that half needs period-based create-tracking, a schema change). Not built now.

**New manual steps from this pass:** paste `013_usage_limits_readable.sql` and
`014_usage_events.sql` in the SQL editor. After 014, the research daily cap can no longer be reset
by deleting a collection — re-test: hit the cap, delete the collection, confirm you still can't run
another query until the 24h window rolls or the cap is raised.

---

### Presentability pass (committed follow-up to Sprint 4.4, started 2026-07-11)

The design *tokens* shipped in Sprint 4.2, but the *craft* on top of them never did — no icons,
plain-applied tokens, a stub Settings page. Clint flagged "bland / looks slapped" repeatedly;
committed as a required item before Phase 4 closes (ROADMAP owner note 2026-07-11). Uses the
`ui-ux-pro-max` skill's component-craft rules. Done in reviewable increments (Clint tests each live).

**Increment 1 — foundation + Settings (🟡 code-complete 2026-07-11, not yet live-verified):**
- **`lucide-react`** installed — one icon family, one stroke width (1.75), sized via props. First
  real icon set (the app was text-only buttons/nav before). CSP-clean (inline SVG, no network).
- **`components/ui/Button.tsx`** — the first shared button primitive (variants primary/secondary/
  ghost/danger, sizes), replacing per-panel hand-rolled class strings (the root of the "slapped"
  inconsistency). Craft baked in per the skill's rules: `cursor-pointer` on every clickable, a
  `focus-visible` ring (accessibility-critical), a subtle transform-only `active:scale` press (no
  layout shift), 150ms transitions, clear disabled state. Exports `buttonClasses()` so `<Link>`/`<a>`
  wear the same look without losing anchor semantics.
- **`components/dashboard/DashboardNav.tsx`** (new client component) — nav with Lucide icons +
  **active-route highlighting** (`nav-state-active` rule; `aria-current="page"`), extracted from the
  server layout so it can read `usePathname`.
- **`ProfileMenu`** — Lucide icons on every row, **`cursor-pointer` on the avatar** (closes Clint's
  earlier pointer-cursor nit), focus ring, and **Settings now links to the real page** (was a
  disabled "coming soon" stub).
- **`/dashboard/settings`** (new) — real Settings page: Account (email, name, member since),
  Appearance (theme), Free-tier limits (the user's caps, RLS-read), Data & privacy, Log out. Honest
  by design: no "delete account" control because account-level deletion isn't built (per-collection
  erasure is, in the Workspace) — the Data section says so plainly rather than showing a dead button.
- Build clean, 12 routes (`/dashboard/settings` added).

**Increments still to do:** login page polish; workspace/sessions/SOC component craft +
empty/loading/error states; richer landing + overall motion. Migrate existing inline buttons onto
the `Button` primitive incrementally.

**Increment 2 — account features + fixes (🟡 code-complete 2026-07-11, executed on Clint's
standing pass; not live-verified). Migration 015 must be pasted.**

1. **Empty-collection Ask bug (live-found):** asking with no ready documents ran the whole
   pipeline (and consumed a research unit) just to say "nothing found". Fixed both layers: the Ask
   button disables with a plain warning when the collection has no `ready` documents, and
   `/research` independently rejects with a clean 400 **before** the session insert and the
   `usage_events` write — an empty ask now costs nothing.
2. **Drag-and-drop upload:** the upload area is a dropzone (highlights while dragging, rejects
   non-PDFs) feeding the same preview-before-upload path as the file picker.
3. **Account deletion with 7-day grace (ADR-020, GATE-26):** Settings gains a GitHub-style
   **Danger zone** — a row (label + description left, outlined red "Delete account" button right,
   matching GitHub's own Danger Zone layout). The typed `DELETE` confirmation is **not** shown
   inline; clicking the row's button pops out a confirmation dialog (first correction, live review
   2026-07-11: it originally showed the input inline by default) — type `DELETE` there →
   `deletion_requested_at` stamped → banner on every dashboard page with the date + a "Withdraw"
   row button → after 7 days, first visit purges all data via the new backend `DELETE /account`
   (collections/storage/documents/chunks/sessions, user-token + RLS), stamps `account_deleted_at`,
   signs out to `/login?reason=deleted`, and later sign-ins are bounced. Honest limits in ADR-020:
   `usage_events`/`security_events` survive by design; the auth identity row needs the 4b
   service-role work (or owner-manual Studio delete).
4. **Theme saved to the account:** new `user_profiles.theme_pref` — any toggle writes it
   (best-effort), and LoginForm adopts it at sign-in on any device. localStorage still handles
   instant paint.
5. **Settings usage bars:** the free-tier section now shows the same %-bars as the dashboard
   (amber ≥80%, red at cap) instead of bare numbers.
6. **Support tab:** `/dashboard/support` (email, LinkedIn, GitHub issues) with honest
   response-time expectations; added to the dashboard nav (LifeBuoy icon).
7. **Public contact email corrected** to `branwelclint.pro@gmail.com` (professional address) on
   the landing page and support page.
8. **Language support (i18n):** noted as a future item in ROADMAP (select languages only), not built.

Build clean (13 routes, `/dashboard/support` added); backend `py_compile` OK. Note: current Lucide
releases dropped brand glyphs (Linkedin/Github), so those cards wear semantic icons
(Briefcase/Bug) instead of logos.

---

### Sprint 4.5 — Project Q&A chatbot + rate limiting

**Status:** 🟡 Code-complete 2026-07-11 (built on Clint's standing pass; condensed threat model in
`docs/ADR-021.md` first, per the new-untrusted-surface rule). Not live-verified; needs migration 016
pasted + `GEMINI_API_KEY` set on Render (separate Google Cloud project). Gate: GATE-27.

**Built:**
- **`backend/app/services/project_chat.py`** — Gemini call via raw httpx (model from `GEMINI_MODEL`,
  default `gemini-3.1-flash-lite`), grounded ONLY on a static curated ARGUS summary (`PROJECT_CONTEXT`) so
  there's no user data or tool for an injection to reach; message capped 1000 chars, history capped
  6 turns; behind the new `gemini_breaker`. No key or any failure → a typed `ChatUnavailable` the
  endpoint turns into a graceful "resting" reply.
- **`POST /chat`** (public — added to `auth.py`'s `PUBLIC_PATHS`): rate limited by an in-process
  **per-IP sliding window** (`CHAT_MAX_PER_IP`/60s, default 6) + a **persisted global daily cap**
  (`CHAT_MAX_PER_DAY`, default 300) via migration 016's `bump_chat_usage` SECURITY DEFINER RPC
  (called over the anon key — no user token on a public endpoint). Over per-IP → 429; over global →
  resting; any upstream failure → resting. Never a 500 on a recruiter's screen.
- **`components/landing/ChatWidget.tsx`** — floating "Ask about ARGUS" widget on the landing page
  only; calls our own `/chat` (already in CSP `connect-src`), Gemini stays server-side; graceful
  429 / resting / cold-start handling.
- `gemini_chat` added to `/status/breakers` (shows on the SOC panel).

**Honest posture (ADR-021):** static grounding makes the blast radius of a prompt injection cosmetic
(no data/tools). Per-IP window is in-process (resets on dyno restart, stated); the persisted global
cap is the durable quota backstop; the cap RPC fails open (a DB blip won't down the feature).

**Clint's manual steps:** paste migration 016; create a Gemini API key in a **separate** Google
Cloud project (easiest path: aistudio.google.com/apikey → "Create API key in new project"; current
keys start with `AQ.`); add it as `GEMINI_API_KEY` on Render (optionally `GEMINI_MODEL`,
`CHAT_MAX_PER_DAY`, `CHAT_MAX_PER_IP`); push; run GATE-27.

**Live-test fixes (2026-07-12, Clint's first 4.5 pass):**
- `/status/breakers` returned 500: `gemini_chat` was added to the endpoint without importing
  `gemini_breaker` in `main.py` (runtime NameError — invisible to `py_compile`). Fixed; backend
  verification now includes a `pyflakes` undefined-name pass on touched files.
- Chat widget made discoverable: labeled pill launcher ("Ask about ARGUS") instead of a bare icon;
  panel header gained expand/shrink, minimize (keeps the conversation), and close (resets it).
- Google sign-in now always shows Google's account chooser (`prompt=select_account`) instead of
  silently reusing the browser's existing Google session — the user confirms or cancels first.
- Support email is plain text with a copy button, no longer a mailto link.
- Chat model default corrected to `gemini-3.1-flash-lite` (was a stale `gemini-2.0-flash`).

---

### Sprint 4.6 — Multimodal PDF ingestion + Report Generation

**Status:** 🟡 **4.6a (Report Generation core) code-complete 2026-07-13, not live-verified.**
4.6b (figure generation) and 4.6c (multimodal image reading) ⏳ not started — 4.6c still gets its
own threat-model ADR before build (image-borne prompt injection is a currently-uncovered channel;
PyMuPDF is text-only today, see BACKLOG Item 4; vision captioning via a Groq vision model with
captions scanned by the same regex + a new `image_derived` trust level stays the locked shape).

#### Sprint 4.6a — Report Generation core (built 2026-07-13)

Full design reasoning in `docs/ADR-022.md`; the short version:

- **Engine:** domain classification → template (built-in cybersec/data-sci; Tavily-looked-up
  structure for other recognized domains, every snippet injection-scanned like Web Scout's;
  general fallback) → whole-collection generation (not top-5 RAG — the plan's caution #2
  confronted, `retriever.py` deliberately bypassed). Two engines by size (revised 2026-07-13):
  **single-pass** for collections that fit the large model's context (≤120k chars → ONE reduce
  call, the common case), **concurrent map-reduce** for larger ones. A completed research session
  can also be the source (reuse its answer → one reduce call, no re-processing).
- **Models:** map/classify on `openai/gpt-oss-20b`, the final reduce on **`openai/gpt-oss-120b`**
  — Groq's largest production model, the one flow that justifies it (caution #1 confronted).
  IDs verified against Groq's live model list 2026-07-13; env-overridable.
- **Async by design:** `POST /reports` inserts the row and returns; an in-process background task
  generates and patches it; the frontend polls. Render's proxy already proved (Sprint 4.3, twice)
  it can't be trusted with long synchronous requests. Cancel = the same DB-signal idiom
  (`POST /reports/{id}/cancel`, checked between model calls, completed-write filtered
  `status=eq.running`). Honest limit: no job queue — a dyno restart orphans the run; a `running`
  row older than 20 min is marked `error` on next read so the UI always terminates.
- **Deliverables:** preview page (`/dashboard/reports/[id]`, polls while running) → download
  `.docx` (python-docx 1.2.0, the one approved new dep, built on demand from the stored Markdown)
  or **Save as PDF** (print-CSS; `@media print` forces light tokens so dark theme doesn't print
  white-on-white; all chrome `print:hidden`). The **needs-proofreading disclaimer** renders in
  the preview banner, inside the .docx, and in print — part of the design, not optional copy.
- **Metering:** one `usage_events` row (`event_type='report'`) per genuine run, counted against
  `usage_limits.max_reports_per_day` (migration **017**: `reports` table + the new cap column,
  tight default 3, existing accounts backfilled to the QA tier). Deleting a report or its
  collection never refunds a unit. Friendly 429 past the cap, checked before any billable work.
- **UI:** new **Reports** tab (list, StatusPill, delete), "Generate a report" section in the
  Workspace collection view (double-guarded: disabled without ready docs + backend 400), usage
  strip and Settings meters gained "Reports today".

**Also in this session (Clint's request, 2026-07-13): the project chatbot now lives inside the
dashboard too**, not just the landing page — mounted in `dashboard/layout.tsx` so signed-in users
can ask how to navigate the app. Its static grounding gained a plain-words tour of every
dashboard tab and the report flow, plus the author's professional contact channels (portfolio
contact form, LinkedIn, professional email — the only three it may give out). Same public `/chat`
backend, same rate limits, still no token attached — the bot can never touch user data (ADR-021's
posture unchanged).

**Clint's manual steps for 4.6a:** (1) paste migration **017** into the Supabase SQL editor —
**before or immediately after the push**: until it runs, every limits read fails back to the
tight defaults (including his own account) and report generation 502s cleanly on the missing
table; (2) `git push` (Render installs python-docx from requirements.txt, Vercel rebuilds);
(3) run GATE-28 (below) and re-run GATE-27(a) to confirm the chatbot's new dashboard placement +
contact answers.

##### Sprint 4.6a live-test fix batch (2026-07-13)

Clint live-tested 4.6a and reported five issues; all addressed same day (no new migration — his
manual steps are unchanged: paste 017, push, re-test):

1. **Report generation too slow / "took forever then failed" with a 200 in the logs.** The 200
   was just the initial `POST /reports` returning; the real failure was in the background task.
   Root cause: the first cut always ran the full map-reduce — ~25 *sequential* Groq calls even for
   a small collection — which exhausted the free-tier rate limit mid-run (and the 8192/medium
   reduce budget could truncate-fail on a long report). Fix (ADR-022 §1, revised): a **single-pass
   engine** for collections that fit the large model's context (≤120k chars → ONE reduce call, the
   common case), map-reduce reserved for genuinely large collections with its batches now running
   **concurrently** and fewer of them; reduce budget raised to 16384 at low effort so it stops
   truncating. Normal reports now finish in seconds, not minutes.
2. **Reuse a completed answer instead of re-processing (concern 4).** `POST /reports` now accepts a
   `session_id` as an alternative to `collection_id`: it builds the report from a completed research
   session's already-synthesized answer (classify + one reduce call), so a user who already asked a
   question turns that answer into a formatted report cheaply. Buttons added on the Workspace Ask
   result and on a completed Session detail page. Still metered as one report.
3. **Chatbot showed raw Markdown symbols** (`*`, `**`, un-clickable links). The widget rendered bot
   replies as plain text; it now renders Markdown (`react-markdown`, links open safely in a new
   tab; user messages stay plain text). The system prompt also gained a voice guide: warm,
   conversational, plain English, prose over bullet lists, no em dashes or buzzwords, contact links
   woven into a sentence — and an explicit "never output raw JSON or escaped characters."
4. **Google sign-in should show the consent screen every time.** Changed `prompt=select_account`
   (account picker only) → `prompt=consent` (the "Google will allow… Continue/Cancel" screen, with
   an account switcher on it, shown on every sign-in — matching the screenshot Clint sent).
5. **Slow "Ask" + low-confidence-then-fine on summaries.** A `meta` (summarize/overview) query
   almost always makes the Critic grade "low" and retry, but the retry retrieves similarly broad
   chunks and grades "low" again — doubling latency without changing the outcome (visible in his
   trace: low → retry → low, with an 18s Critic call). `graph.py`'s `route_after_critic` now skips
   the retry for `meta` intent only; specific/broad questions keep the loop (a targeted retry can
   still find real missing info there). The confidence badge still reports the honest first-pass
   grade. This is a latency fix on the documented ADR-015 non-determinism, not a claim it's gone.

#### Sprint 4.6b / 4.6c — still to build

**Owner clarifications (Clint, 2026-07-11 — this is the product's headline capability):** the
point of ARGUS is generating meaningful, presentable output from messy/raw/unorganized reports.
Two halves, both figures-related: (a) **reading** figures/images inside uploaded PDFs (the vision
half above), and (b) **generating** figures — charts/graphs built from the documents' data,
rendered into the output report alongside the text. Explicitly NOT AI image generation; graphs
only. The generated report must carry a **visible disclaimer**: the output may still be unclean
and needs the user's own proofreading and organizing — the tool makes the work easier, it does not
replace the human pass. That disclaimer is part of the design, not optional copy.

**Value-proposition framing (2026-07-11 strategy discussion — read this before planning 4.6).**
The honest answer to "why use ARGUS instead of free Claude/ChatGPT/Gemini?" is NOT "6 agents" or
"security" — a casual user feels neither, and for a single report a free frontier model often
writes *better* (bigger model, sees the whole document). ARGUS's defensible value is the
**deliverable layer** the free chat tools don't remove friction for:
- a real downloadable **file** (`.docx`/PDF), not chat text to copy-paste-and-reformat;
- **consistent, domain-appropriate structure** via templates (a cybersec report looks like one
  every time), where a free chat gives a different shape each ask;
- **generated figures embedded in the report**, not just described;
- **encoded report expertise** so a user who can't prompt for a good report still gets one.
The bar is a professional-*enough* draft the user finishes in ~5 minutes of editing, not
out-writing a frontier model. The moment the output is just "text with headings," the skeptic
wins — so the file/structure/figures ARE the product, not decoration.

**Two cautions this planning pass must confront (don't assume the Q&A plumbing carries over):**
1. **Model quality vs. free tier.** "Professional output" and "smallest cheap Groq model" are in
   tension. Report generation is the one flow that likely justifies the *best available* model per
   run — which is exactly why its `usage_limits` metering is load-bearing, not cosmetic. Decide the
   model deliberately; don't default to the Q&A model.
2. **RAG may be the wrong engine here.** The Q&A pipeline retrieves top-5 chunks — right for
   "answer a question across many docs," likely *wrong* for "synthesize a whole messy document into
   a report," which wants the whole document (or a map-reduce summary) in context. 4.6 may need to
   bypass or heavily augment retrieval. Confront this in the plan, don't inherit `retriever.py` by
   default.

**Project-identity framing (Clint, 2026-07-11, applies beyond 4.6):** ARGUS is pitched as a
**proof-of-concept that demonstrates production-grade practices and industry-standard
architecture** — built to prove understanding of how these systems are engineered, NOT as a live
product serving customers at scale (it runs on sleeping free tiers). "Ambitious in scope,
production-grade in practice, proof-of-concept in maturity." This is the same doc-honesty rule the
whole project runs on, applied to how the project describes *itself*: claim the practices it
demonstrates, never an operational reality (SLAs, load, real users) it doesn't have. See
`docs/BLUEPRINT.md` target line and the [[argus-positioning]] memory.

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
