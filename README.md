# ARGUS

**In plain terms:** upload a document, ask it a question, get a real answer with sources,
not a guess. The system is also built to notice and block someone trying to trick the AI
into ignoring its own rules, whether that trick is hidden inside a document or typed
directly into the question box.

A multi-agent AI research assistant. Built as a portfolio project for AI Engineering and
DevOps roles, with security treated as a full build phase, not an afterthought.

**Live demo:** https://argus-nine-ivory.vercel.app
**Backend API:** https://argus-am5t.onrender.com

> Render's free tier sleeps after 15 minutes of inactivity. First request after that can take
> 30-60 seconds to wake up.

## What it does

1. Sign in (Supabase Auth)
2. Create a collection, upload a PDF
3. The backend extracts the text, splits it into chunks, embeds each chunk, stores it in a
   vector database
4. Ask a question about that document
5. A 3-agent pipeline retrieves the relevant chunks, drafts an answer grounded only in that
   content, and formats a cited markdown report

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, deployed on Vercel |
| Backend | FastAPI, deployed on Render |
| Database | Supabase (Postgres + pgvector + Auth + Storage) |
| Agent orchestration | LangGraph (Retriever -> Synthesizer -> Reporter) |
| LLM inference | Groq (openai/gpt-oss-20b) |
| Embeddings | Hugging Face hosted Inference API (all-MiniLM-L6-v2) |
| PDF extraction | PyMuPDF |

## Status

- **Phase 1, MVP Core: complete.** Full pipeline works end to end on the live deployed URLs
  above, not just localhost.
- **Phase 2, Security Hardening: in progress, verified live, not just written.** Sprint 2.1
  (document-level injection defense) and Sprint 2.2 (query-text injection guard) are
  deployed and tested against the real app, not just code-complete. See `PHASE2.md` and
  `CONTINUITY.md` for exact current status, `docs/ADVERSARIAL-TESTS.md` for real pass/fail
  results, and `docs/SECURITY-RESEARCH-LOG.md` for how current external CVEs and OWASP
  guidance were checked against this specific codebase.

This project follows a deliberate 5-phase build plan, shipping and deploying after every
phase instead of building everything at once. Full plan in `BLUEPRINT.md`.

## Security approach

Every piece of content the agents see gets labeled by where it came from (uploaded document,
web search, the user's own question). The agents are explicitly instructed to treat labeled
reference content as data to summarize, never as instructions to follow. Content pulled from
documents is also scanned for injection patterns before it ever reaches the model, and
direct attacks typed into the query box go through a separate two-layer check (an AI
classifier with few-shot examples, plus a regex fallback that runs on every request, not
just when the classifier is unreachable). Browser-level hardening (CSP, security headers,
an idle session timeout) and dependency vulnerability scanning are also in place.
Authorization is enforced at the database level (Postgres Row Level Security), not just in
application code. Architecture decisions, including ones that changed from the original
plan and why, and real bugs found during testing and how they were fixed, are documented as
ADRs in `docs/`, not papered over.

## Repository structure

```
argus/
├── frontend/               Next.js app (Vercel)
├── backend/
│   └── app/
│       ├── agents/          LangGraph pipeline: retriever, synthesizer, reporter
│       ├── middleware/      JWT auth (Supabase ES256/JWKS)
│       └── services/        PDF processing, Supabase client, injection guard
├── supabase/
│   └── migrations/          SQL, run in order in the Supabase SQL editor
├── docs/                    ADRs, adversarial test suite, security research log
├── BLUEPRINT.md              Full original technical spec (V3)
├── PHASE1.md, PHASE2.md      Sprint-by-sprint plan and build log, per phase
└── CONTINUITY.md             Live status snapshot, paste at the start of a new session
```

## Known limitations (accepted, not hidden)

- No signup page or OAuth yet, login only
- Can't read figures or images inside PDFs, text only (also means the current injection
  defenses are text-only, see `docs/SECURITY-RESEARCH-LOG.md`)
- File processing happens synchronously in the request
- Render's free tier has a cold-start delay after inactivity
- No keyword list or classifier catches every possible attack phrasing, this is a
  structural limit of the approach, not a bug, see `docs/ADVERSARIAL-TESTS.md`

## Local setup

```
git clone https://github.com/yoimuri/argus.git
cd argus
docker compose up --build
```

Copy `.env.example` to `.env` (and `frontend/.env.example` to `frontend/.env.local`) and
fill in your own Supabase, Hugging Face, and Groq credentials.

## Documentation

- `BLUEPRINT.md`, full technical specification and roadmap
- `PHASE1.md`, `PHASE2.md`, sprint-by-sprint build plan and build log
- `docs/HOW-WE-BUILT-THIS.md`, plain-language walkthrough of how the system actually works
- `docs/ADR-*.md`, individual architecture decisions, including real bugs and how they
  were found and fixed
- `docs/ADVERSARIAL-TESTS.md`, security test cases and real results, pass and fail alike
- `docs/SECURITY-RESEARCH-LOG.md`, current external CVEs and OWASP guidance checked
  against this codebase specifically

## Author

Clint Branwel D. Poyaoan ([@yoimuri](https://github.com/yoimuri))
