# ARGUS — Phase 1: MVP Core
**Status:** ✅ Complete (verified live)
**Timeline:** Weeks 1–4
**SDLC Stages:** Requirements → Architecture Design → Build → Test → Deploy
**Prerequisite:** None (this is the foundation everything else runs on)

---

## What this phase builds

A working 3-agent research pipeline. A user signs in, uploads a PDF, asks a research question,
and gets back a cited markdown report. That is the entire scope of Phase 1. Nothing more.

**Active services this phase:**

| Service | Role | Platform |
|---|---|---|
| Next.js 16 frontend | Auth UI + file upload + query input + report display | Vercel |
| FastAPI backend | REST API + 3 LangGraph agents | Render |
| Supabase | Auth + Postgres + pgvector + file storage | Supabase cloud |

MCP server and Langfuse are NOT in scope this phase.

---

## Acceptance Criteria — What "Stable" Means

This exact user journey must work on the **live deployed URL** (not localhost) before Phase 2 starts:

1. User visits the Vercel URL and signs in via Supabase Auth
2. User creates a collection and uploads a PDF (use a CTI report for the real demo)
3. PDF is extracted, converted to markdown, chunked, embedded via HuggingFace, stored in pgvector
4. User types a research question against that collection
5. Retriever pulls relevant chunks → Synthesizer drafts a response → Reporter formats with citations
6. User sees a cited markdown report referencing specific sections of their uploaded document

Localhost does not count. If any step fails on the deployed version, Phase 1 is not done.

---

## Sprint Breakdown

One sprint = one focused work session. Don't start the next until the current stable state is
confirmed. Every sprint has a testable end condition, not just "the code is written."

### Sprint 1: Monorepo scaffold + local Docker
**Session goal:** GitHub repo exists, directory structure is correct, docker-compose.yml spins up
FastAPI skeleton locally.
**Stable state:** `docker compose up` → `GET localhost:8000/health` returns `{"status": "ok"}`
**Outputs:** `docker-compose.yml`, `.env.example`, full directory tree, `pyproject.toml`,
skeleton `main.py`

### Sprint 2: Supabase schema
**Session goal:** 5 core tables live in Supabase, pgvector extension enabled, RLS active.
**Tables:** `user_profiles`, `collections`, `documents`, `document_chunks`
(vector(384) + IVFFlat index), `research_sessions`
**Stable state:** All tables visible in Supabase dashboard. Run a test INSERT into
`document_chunks` with a dummy vector. Confirm RLS rejects a query with no JWT.
**Outputs:** `supabase/migrations/001_core_schema.sql`

### Sprint 3: JWT auth middleware + Next.js shell
**Session goal:** FastAPI validates Supabase JWT on all routes except `/health`. Next.js has a
working login/logout flow.
**Stable state:** Unauthenticated `POST /collections` → 401. Authenticated request (Supabase JWT
in `Authorization: Bearer` header) → passes through to the handler.
**Outputs:** `backend/app/middleware/auth.py`, Next.js auth pages

### Sprint 4: File upload + PDF processing pipeline
**Session goal:** Upload a PDF via the frontend → pdfplumber extracts text → formatted to
markdown → chunked → embedded via HuggingFace → stored in pgvector.
**Stable state:** Upload a real CTI report PDF. Open Supabase dashboard. See rows in
`document_chunks` with a populated `embedding` column.
**Outputs:** `backend/app/services/document_processor.py`, upload endpoint, Next.js upload
component

### Sprint 5: 3-agent LangGraph pipeline
**Session goal:** LangGraph state machine with Retriever → Synthesizer → Reporter runs a
query against stored chunks and returns a report.
**Stable state:** `POST /research` returns a JSON response containing a cited markdown report.
Chunk IDs from `document_chunks` appear in the citations array.
**Outputs:** `backend/app/agents/` (graph definition + 3 agent node files), `/research` endpoint

### Sprint 6: End-to-end deploy + smoke test
**Session goal:** Full flow works on live deployed URLs. Vercel frontend → Render backend →
Supabase.
**Stable state:** Complete the full acceptance criteria journey on the live URL, not localhost.
Then force a Render redeploy and confirm Groq and Supabase secrets are still live afterward.
This is the exact lesson from the Cloudflare Worker project applied before it bites again.

---

## Key Decisions (Pre-made from V3 Blueprint)

| Decision | Choice | Why |
|---|---|---|
| Embeddings | HuggingFace `all-MiniLM-L6-v2` | Free, 384 dimensions, local CPU fallback available |
| Vector dimensions | 384 | Fixed at schema creation; changing it later means re-embedding everything |
| PDF extraction | `pdfplumber` → markdown formatter | Cleaner chunks than raw text; better retrieval quality |
| LangGraph version | 1.2.6 (June 18, 2026) | Latest stable; Python 3.10+ required |
| Next.js version | 16.2.9 LTS (June 9, 2026) | Current LTS; Next.js 15 ends Oct 2026 |
| Auth pattern | Supabase JWT, server-side validation only | CORS is bypassable by direct calls; JWT is the real gate |
| Demo document type | CTI reports (Verizon DBIR, CISA advisories, Mandiant) | Free to download, and representative of the security domain the project targets |

---

## ADRs (Architecture Decision Records)

Write these as you make decisions. The ones below are pre-made from the blueprint.

### ADR-000: Supabase as Single Data-Layer SPOF
**Date:** [Fill when you create the Supabase project]
**Decision:** Use Supabase for all data concerns: auth, Postgres, pgvector, realtime, storage.
**Context:** Splitting these into separate managed services adds infrastructure complexity and
cost beyond what a free-tier solo portfolio project justifies.
**Consequence:** If Supabase has an outage, ARGUS is fully down. No partial degradation at the
data layer is possible.
**Production upgrade path:** Separate vector DB (Pinecone/Weaviate for 100M+ scale), dedicated
managed auth (Auth0), Postgres with read replicas.
**Status:** Accepted. The production upgrade path above is the deliberate answer to "what would
you do differently at real scale?"

### ADR-001: [Title]
**Date:**
**Decision:**
**Context:**
**Consequence:**
**Status:**

---

## Build Log

One block per sprint: what was built, why it exists, what broke, and how it was fixed.

> Format: Date → Goal → What you built → What broke → How you fixed it → End state

---

**[June 20, 2026] — Sprint 1**
Goal: Get a minimal FastAPI app running inside Docker, confirm it's reachable.
Built: backend/main.py with a single /health route, Dockerfile (python:3.12-slim base),
docker-compose.yml exposing port 8000, requirements.txt pinned to fastapi==0.137.2 and
uvicorn[standard]==0.48.0.
Broke: Nothing in the build itself. My own mistake was checking the docker compose
terminal log for the {"status":"ok"} response instead of actually hitting the route
in the browser. The terminal log only shows the server starting, not the route response.
Fixed: Opened http://localhost:8000/health directly, confirmed {"status":"ok"}.
End state: docker compose up --build successfully serves /health on localhost:8000.

---

**[June 20, 2026] — Sprint 2**
Goal: 5 core tables live with pgvector + RLS, confirm RLS actually blocks unauthenticated access.
Built: supabase/migrations/001_core_schema.sql, with 5 tables, a vector(384) column with IVFFlat
index, and RLS policies on all 5 tables scoped to auth.uid() = user_id.
Broke: First attempt in the SQL editor failed because I pasted the CREATE TABLE along with the
terminal command (cat > ... << EOF), not just the contents of the file. Also learned SQL runs at
superuser, so it's not a valid RLS test by default.
Fixed: Pasted file contents only. Used the "set role anon" technique to simulate a no-JWT request
and confirm 0 rows show even when data exists.
End state: 5 tables live, RLS confirmed blocking anon access via role simulation.

---

**[June 21, 2026] — Sprint 3 (backend half)**
Goal: FastAPI middleware validates Supabase JWT (ES256/JWKS) on all routes except /health.
Built: app/middleware/auth.py using PyJWT's PyJWKClient against the project's JWKS endpoint.
Broke: Three layered bugs, found one at a time.
  1. JWKS fetch returned 401. Supabase's API gateway requires an `apikey` header on every
     request through it, even endpoints serving public keys. PyJWKClient has no apikey by
     default, so it was rejected before reaching the actual verification logic.
  2. After adding the apikey header, fetch returned 404. I wasted time testing the wrong path
     (/auth/v1/jwks vs the correct /auth/v1/.well-known/jwks.json) before confirming both via
     direct curl.
  3. Even with the correct path in code, still 404. SUPABASE_URL in .env had a leftover
     /rest/v1/ suffix from when I was looking at the Data API page, so the code was building
     .../rest/v1/auth/v1/.well-known/jwks.json, a path that doesn't exist.
Fixed: Added apikey header to PyJWKClient, confirmed correct JWKS path via curl against the
live project before touching code again, corrected SUPABASE_URL to the bare project URL.
End state: Unauthenticated POST /collections → 401. Authenticated request with a real
Supabase-issued JWT → 200 with verified user_id attached via request.state.

---

**[June 21, 2026] — Sprint 3 (frontend half)**
Goal: Working login/logout flow in Next.js, gated by session state.
Built: app/login/page.tsx (signInWithPassword), app/dashboard/page.tsx (server component,
redirects if no user), app/auth/signout/route.ts, proxy.ts (Next.js 16's replacement for
middleware.ts) refreshing sessions and redirecting logged-out users to /login.
Broke: Nothing this time, first clean end-to-end run. Followed Supabase's official Next.js 16
bootstrap pattern exactly (getAll/setAll cookies, proxy.ts naming) instead of older tutorials
that still reference middleware.ts and get/set/remove, which would have broken silently.
Fixed: N/A.
End state: Full login → dashboard → logout flow confirmed working against the real Supabase
Auth backend, same test@argus.dev user created in Sprint 2.

---

**[June 21, 2026] — Sprint 4 (backend half)**
Goal: Upload a PDF, extract text, chunk it, embed it, store rows in document_chunks.
Built: document_processor.py (pdfplumber extraction, fixed-size chunking with overlap,
all-MiniLM-L6-v2 local embedding via sentence-transformers), POST /collections, POST
/collections/{id}/documents. All writes go through Supabase's REST API using the caller's
own JWT, not the secret key, so RLS still applies to every insert, consistent with ADR-001.
Broke:
  1. Container crashed on startup: "python-multipart" missing, FastAPI's File()/UploadFile
     support depends on it even though nothing imports it directly by name.
  2. First real upload returned chunks_created: 0. Added temporary debug prints to isolate
     extraction vs chunking, confirmed the test PDF had no real text layer, a known
     pdfplumber limitation already listed in this doc's Known Limitations, not a code bug.
  3. Caught a real authorization gap before shipping: the documents INSERT policy only
     checks the new row's own user_id, not whether collection_id (from the URL) actually
     belongs to the caller. Fixed with an explicit ownership check, RLS-filtered, 404 either
     way if it's missing or not theirs, so existence isn't leaked.
Fixed: see above.
End state: Successfully processed a real 2025 Verizon DBIR PDF end-to-end. 35 chunks created
with populated embedding vectors, confirmed in document_chunks via Table Editor. Sprint 2's
leftover RLS test fixture cleaned out via cascade delete.

**[June 21, 2026] — Sprint 4 (frontend half)**
Goal: Upload UI wired to the real backend endpoint.
Built: UploadPanel.tsx (create collection, pick file, upload), CORS middleware added to
FastAPI (different ports = different origins, needed explicit allow_origins).
Broke: Nothing this round.
Fixed: N/A.
End state: Full browser flow confirmed working end-to-end: login → create collection →
upload PDF → 36 chunks created, against a real Verizon DBIR 2025 PDF.

---




---
*(Add a new block for each session)*

---

## Known Limitations This Phase (Accepted, Not Ignored)

| What is missing | When it gets added |
|---|---|
| Injection protection | Phase 2 |
| Circuit breakers | Phase 2 |
| Web Scout agent (live web search) | Phase 3 |
| Orchestrator + Critic agents | Phase 3 |
| Langfuse observability | Phase 3 |
| Debug Diary backend | Phase 3 |
| SOC dashboard | Phase 4 |
| MCP server | Phase 5 |
| Reading figures/images inside PDFs | Post-Phase 5, documented permanent limitation |
| Async file processing | Upgrade path: Celery task queue, post-Phase 5 |
| Upload progress/loading indicator | Deferred to a UI polish pass once the core pipeline is feature-complete |

---

## Integration Gate — Before Phase 2 Can Start

Phase 2 layers security directly onto Phase 1's FastAPI middleware. These must ALL be true before
touching Phase 2 code:

- [ ] `/research` endpoint returns a cited report on the **deployed** Render URL
- [ ] JWT middleware rejects unauthenticated requests with 401 on the deployed service
- [ ] Supabase connection stable from the deployed backend (not just localhost)
- [ ] PDF upload → embedding → retrieval confirmed working with a real document
- [ ] Render redeploy tested: Supabase and Groq API keys survive the redeploy without being reset

**[June 23, 2026] — Sprint 6 (mid-deploy fix)**
Goal: Deploy backend to Render's free tier.
Broke: Render killed the container with "Out of memory (used over 512Mi)". Root cause:
sentence-transformers pulls in torch, whose footprint alone exceeded the entire free-tier
RAM ceiling before the app even finished starting.
Fixed: Replaced local embedding (sentence-transformers + torch) with calls to Hugging
Face's hosted Inference API for the same model (all-MiniLM-L6-v2), removing torch from
the backend entirely. Hit a second issue along the way: HF's fine-grained tokens default
to no Inference Providers permission, causing 403s until the token was regenerated with
that scope explicitly enabled.
End state: Local re-test confirmed full pipeline (upload, 36 chunks, embeddings, research
query with citations) still works correctly through the new hosted embedding path.
