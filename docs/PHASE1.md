# ARGUS — Phase 1: MVP Core
**Status:** 🔵 In Progress
**Timeline:** Weeks 1–4
**SDLC Stages:** Requirements → Architecture Design → Build → Test → Deploy
**Prerequisite:** None (this is the foundation everything else runs on)

---

## What You're Building

A working 3-agent research pipeline. User signs in, uploads a PDF, asks a research question,
gets back a cited markdown report. That is the entire scope of Phase 1. Nothing more.

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

One sprint = one Claude session. Do not start the next sprint until the current stable state is
confirmed. Every sprint has a testable end condition, not just "I wrote the code."

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
| Vector dimensions | 384 | Fixed at schema creation — changing later means re-embedding everything |
| PDF extraction | `pdfplumber` → markdown formatter | Cleaner chunks than raw text; better retrieval quality |
| LangGraph version | 1.2.6 (June 18, 2026) | Latest stable; Python 3.10+ required |
| Next.js version | 16.2.9 LTS (June 9, 2026) | Current LTS; Next.js 15 ends Oct 2026 |
| Auth pattern | Supabase JWT, server-side validation only | CORS is bypassable by direct calls; JWT is the real gate |
| Demo document type | CTI reports (Verizon DBIR, CISA advisories, Mandiant) | Free to download; directly relevant to Trend Micro / Accenture interviews |

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
**Status:** Accepted. This is your answer when an interviewer asks "what would you do
differently at production scale?"

### ADR-001: [Title]
**Date:**
**Decision:**
**Context:**
**Consequence:**
**Status:**

---

## Build Log

Fill in one block per Claude session. This becomes your interview prep — you should be able to
explain what each piece does, why it exists, and what broke during build.

> Format: Date → Goal → What you built → What broke → How you fixed it → End state

---

**[Date] — Sprint 1**
Goal:
Built:
Broke:
Fixed:
End state:

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

---

## Integration Gate — Before Phase 2 Can Start

Phase 2 layers security directly onto Phase 1's FastAPI middleware. These must ALL be true before
touching Phase 2 code:

- [ ] `/research` endpoint returns a cited report on the **deployed** Render URL
- [ ] JWT middleware rejects unauthenticated requests with 401 on the deployed service
- [ ] Supabase connection stable from the deployed backend (not just localhost)
- [ ] PDF upload → embedding → retrieval confirmed working with a real document
- [ ] Render redeploy tested: Supabase and Groq API keys survive the redeploy without being reset