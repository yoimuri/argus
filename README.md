# ARGUS

A multi-agent AI research assistant. Upload a document, ask a question, get back a cited
answer, while a security layer actively defends against prompt injection. Built as a
portfolio project for AI Engineering and DevOps roles.

**Live demo:** https://argus-nine-ivory.vercel.app
**Backend API:** https://argus-27g9.onrender.com

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
- **Phase 2, Security Hardening: in progress.** Sprint 2.1 (trust_level tagging + chunk
  injection guard) and Sprint 2.2 (query-text injection guard) are code-complete. See
  `PHASE2.md` and `CONTINUITY.md` for exact current status.

This project follows a deliberate 5-phase build plan, shipping and deploying after every
phase instead of building everything at once. Full plan in `BLUEPRINT.md`.

## Security approach

Every piece of content the agents see gets labeled by where it came from (uploaded document,
web search, the user's own question). The agents are explicitly instructed to treat labeled
reference content as data to summarize, never as instructions to follow. Content pulled from
documents is also scanned for injection patterns before it ever reaches the model, and
direct attacks typed into the query box go through a separate two-layer check (an AI
classifier, with a regex fallback if that classifier is unreachable). Authorization is
enforced at the database level (Postgres Row Level Security), not just in application code.
Architecture decisions, including ones that changed from the original plan and why, are
documented as ADRs in `docs/`.

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
├── docs/                    ADRs, adversarial test suite, build-process notes
├── BLUEPRINT.md              Full original technical spec (V3)
├── PHASE1.md, PHASE2.md      Sprint-by-sprint plan and build log, per phase
└── CONTINUITY.md             Live status snapshot, paste at the start of a new session
```

## Known limitations (accepted, not hidden)

- No signup page or OAuth yet, login only
- Can't read figures or images inside PDFs, text only
- File processing happens synchronously in the request
- Render's free tier has a cold-start delay after inactivity

## Local setup

```
git clone https://github.com/yoimuri/argus.git
cd argus
docker compose up --build
```

Copy `.env.example` to `.env` and fill in your own Supabase, Hugging Face, and Groq
credentials.

## Documentation

- `docs/BLUEPRINT.md`, full technical specification and roadmap
- `docs/PHASE1.md`, `docs/PHASE2.md`, sprint-by-sprint build plan and build log
- `docs/HOW-WE-BUILT-THIS.md`, plain-language walkthrough of how the system actually works
- `docs/ADR-*.md`, individual architecture decisions
- `docs/ADVERSARIAL-TESTS.md`, security test cases and results

## Author

Clint Branwel D. Poyaoan ([@yoimuri](https://github.com/yoimuri))