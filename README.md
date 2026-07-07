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
| Prompt injection detection | Hugging Face hosted Inference API (protectai/deberta-v3-base-prompt-injection-v2) |
| PDF extraction | PyMuPDF |

## Status

- **Phase 1, MVP Core: complete.** Full pipeline works end to end on the live deployed URLs
  above, not just localhost.
- **Phase 2, Security Hardening: in progress, verified live, not just written.** Sprint 2.1
  (document-level injection defense) and Sprint 2.2 (query-text injection guard) are
  deployed and tested against the real app, not just code-complete. See `docs/PHASE2.md`
  for exact current status, `docs/ADVERSARIAL-TESTS.md` for real pass/fail
  results, and `docs/SECURITY-RESEARCH-LOG.md` for how current external CVEs and OWASP
  guidance were checked against this specific codebase.

This project follows a deliberate 5-phase build plan, shipping and deploying after every
phase instead of building everything at once. Full plan in `docs/BLUEPRINT.md`.

## Security approach

The design assumes detection will sometimes miss, so it leans on containment as much as
detection. Everything the agents see is labeled by origin. Uploaded document, web search, the
user's own question, and the agents are instructed to treat reference content as data to
summarize, never as instructions to follow. Document content is scanned for injection patterns
both before storage and again before the model reads it. Direct attacks in the query box go
through a two-layer check: a purpose-built classifier that judges intent (so reworded attacks
are caught, not just known keywords), backed by a regex fallback that fails closed if the
classifier is unreachable. The point is that even a missed injection is still handled as data,
never executed.

Around that sit the operational safeguards: database-level authorization (Postgres Row Level
Security) rather than app-code checks alone, circuit breakers on every external AI call so an
outage degrades gracefully, a nonce-based Content-Security-Policy, an idle session timeout, and
dependency scanning. No layer claims to catch every attack. Prompt injection is an open problem,
and the docs say so plainly. Decisions that changed from the original plan, and real bugs found
in testing, are written up as ADRs rather than papered over.

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
└── docs/                    ADRs, adversarial test suite, security research log,
                             BLUEPRINT.md (full spec), PHASE1.md / PHASE2.md (build logs)
```

## Known limitations (accepted, not hidden)

- No signup page or OAuth yet, login only
- Can't read figures or images inside PDFs, text only (also means the current injection
  defenses are text-only, see `docs/SECURITY-RESEARCH-LOG.md`)
- File processing happens synchronously in the request
- Render's free tier has a cold-start delay after inactivity
- No keyword list or classifier catches every possible attack phrasing, this is a
  structural limit of the approach, not a bug, see `docs/ADVERSARIAL-TESTS.md`
- Vague or meta questions ("summarize for me") can return "no relevant information found"
  instead of a real answer. Retrieval currently pulls a fixed top-5-by-similarity sample
  with no query-intent understanding. Planned fix is Phase 3's Orchestrator agent, not a
  quick prompt patch, see `docs/BLUEPRINT.md`

## Privacy

Data is encrypted in transit (TLS) and at rest (Supabase platform default), and Postgres
Row Level Security means one user's data is invisible to another. That said, this system
is not end-to-end encrypted, and can't be: retrieval-augmented generation requires the
server to read document text in plaintext to chunk, embed, and answer questions about it.
Document content is also processed by two third-party APIs (Groq for LLM inference,
Hugging Face for embeddings and injection detection). Users can delete their own
collections (and everything under them, including the underlying files) at any time. Full
honest posture, including what a real public launch would still require, is in
`docs/ADR-013.md`.

## Local setup

```
git clone https://github.com/yoimuri/argus.git
cd argus
docker compose up --build
```

Copy `.env.example` to `.env` (and `frontend/.env.example` to `frontend/.env.local`) and
fill in your own Supabase, Hugging Face, and Groq credentials.

## Documentation

- `docs/BLUEPRINT.md`, full technical specification and roadmap
- `docs/PHASE1.md`, `docs/PHASE2.md`, sprint-by-sprint build plan and build log
- `docs/ADR-*.md`, individual architecture decisions, including real bugs and how they
  were found and fixed
- `docs/ADVERSARIAL-TESTS.md`, security test cases and real results, pass and fail alike
- `docs/SECURITY-RESEARCH-LOG.md`, current external CVEs and OWASP guidance checked
  against this codebase specifically

## Author

Clint Branwel D. Poyaoan ([@yoimuri](https://github.com/yoimuri))
