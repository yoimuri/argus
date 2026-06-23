# ARGUS — Session Handoff (June 23, 2026)

Use this doc to continue work in a new conversation. Copy/paste or attach as context.

---

## Project URLs

| Service | URL |
|---------|-----|
| Vercel frontend (production) | `https://argus-nine-ivory.vercel.app` |
| Render backend | `https://argus-27g9.onrender.com` |
| GitHub | `https://github.com/yoimuri/argus` |

---

## Architecture (Phase 1 MVP)

```
Browser (Vercel)  --HTTPS + JWT-->  FastAPI (Render)  -->  Supabase (auth + Postgres + pgvector)
                                         |
                                         +--> Hugging Face Inference API (embeddings)
                                         +--> Groq API (research / synthesizer)
```

- Frontend calls Render **directly from the browser** (not via Next.js API routes).
- Auth: Supabase JWT validated on every backend route except `/health`.
- Upload pipeline: PDF → pdfplumber extract → chunk → HF embed → store in `document_chunks`.

---

## Environment variables

### Vercel (frontend only)

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://argus-27g9.onrender.com` (no trailing slash, must be `https://`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://gidhqyjzyrcnzpkodymw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key |

**Important:** `NEXT_PUBLIC_*` vars are baked in at **build time**. Changing them requires a **Vercel redeploy**.

Do **not** put `NEXT_PUBLIC_*` on Render — the backend ignores them.

### Render (backend only)

| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Same project URL as above (no `/rest/v1/` suffix) |
| `SUPABASE_PUBLISHABLE_KEY` | Same publishable/anon key |
| `HF_TOKEN` | Hugging Face token with **Inference Providers** permission |
| `GROQ_API_KEY` | Groq API for research synthesizer |

Not required by running app code: `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD` (useful for admin CLI / migrations only).

---

## Problems diagnosed this session

### 1. Upload: "Network error: Failed to fetch"

**Cause (initial):** Frontend could not reach backend — wrong/missing `NEXT_PUBLIC_API_URL`, CORS, or Render asleep.

**Cause (after env fixed):** `502 Bad Gateway` with empty body → Render proxy lost connection to worker.

**Root cause (confirmed in Render dashboard):**
```
Ran out of memory (used over 512MB) while running your code.
```

Render **free tier = 512 MB RAM hard cap** for the entire Python process.

### 2. Collections CORS errors

Preflight `400` / `CORS error` when `NEXT_PUBLIC_API_URL` wrong or origin not in backend `allow_origins`.

Backend CORS (in `backend/main.py`):
```python
allow_origins=["http://localhost:3000", "https://argus-nine-ivory.vercel.app"]
```

Preview Vercel URLs (`*-git-*.vercel.app`) are **not** allowed unless added.

### 3. Login "Invalid login credentials"

Separate from upload — Supabase auth issue (wrong email typo, user not in project, or env keys point at wrong project). App has login only, no signup page. Create users in Supabase Dashboard → Authentication → Users.

Test account target: `test@argus.dev` / `test` (auto-confirm enabled).

---

## Why curl/local works but deployed fails

| | Local (Docker / curl) | Render free tier |
|--|----------------------|------------------|
| RAM limit | Host machine (often 8–16 GB+) | **512 MB hard cap** |
| OOM behavior | Rarely hits limit | Process killed → **502 Bad Gateway** |
| Cold start | N/A | ~30–60s after 15 min idle |

**File size on disk ≠ memory used.** User's DBIR PDF `2025veri.pdf` is **~2.7 MB (2,832,253 bytes)** but still OOM'd on Render because:

1. **Baseline RSS** before upload: Python + FastAPI + pdfplumber/pdfminer + PyJWT + (previously) LangGraph imported at startup.
2. **Peak during upload (old code):** `file_bytes` + pdfplumber PDF object + full extracted text + all chunk strings + all embeddings + HF JSON payload — all held at once.
3. **Complex PDFs** (DBIR: many pages, fonts, layout) can spike memory far above file size during `pdfplumber` parse.

Local curl against `localhost:8000` never hits the 512 MB cage.

---

## Code changes made this session (not yet committed unless you committed separately)

### `backend/app/services/document_processor.py`

**Before:** Single `process_pdf(file_bytes)` — parse entire PDF in memory, embed all chunks in one HF call, return all results.

**After:**
- `extract_chunks_from_pdf_bytes()` — writes PDF to **temp file**, parses page-by-page, returns chunk strings only.
- `iter_embedded_chunk_batches()` — embeds **8 chunks at a time** (configurable `EMBED_BATCH_SIZE`).
- `embed_query()` — handles HF response shape for single-string queries.
- Removed monolithic `process_pdf()`.

### `backend/main.py`

- `MAX_UPLOAD_BYTES`: **50 MB → 25 MB** with clearer error message.
- Upload flow: extract chunks → `del file_bytes` → batch embed + batch Supabase insert.
- **Lazy import** of `research_graph` inside `/research` only (LangGraph adds ~100MB+ RSS; upload no longer loads it at startup).

### `frontend/app/dashboard/UploadPanel.tsx`

- Added `MAX_UPLOAD_BYTES = 25 * 1024 * 1024`.
- Added `handleFileChange()` — rejects files over 25 MB before upload with readable error.
- Added helper text: *"PDFs up to 25 MB. Large reports (e.g. DBIR) may need a compressed export."*

---

## What still needs to happen

1. **Commit and push** the changes above.
2. **Redeploy Render** (backend) — OOM fixes only apply after deploy.
3. **Redeploy Vercel** (frontend) — if UploadPanel changes not live yet.
4. **Re-test upload** with `2025veri.pdf` (~2.7 MB) after deploy.
5. If still OOM: check Render logs; consider further optimizations (see below).
6. Phase 1 integration gate in `docs/PHASE1.md` — all items still unchecked for deployed smoke test.

---

## Further optimizations if 2.7 MB still OOMs after deploy

1. **Lazy-import pdfplumber** inside extract function only (not at module top).
2. **Page-at-a-time chunking** without joining full document text (avoid holding entire DBIR text string).
3. **Render Standard** ($25/mo, 2 GB RAM) — only paid tier with meaningful RAM bump; Starter is still 512 MB.
4. **Async job queue** (post–Phase 1) — accept upload, return 202, process in background.
5. **UptimeRobot** ping `https://argus-27g9.onrender.com/health` every 5 min — prevents cold-start 502s (separate from OOM).

---

## Error message → meaning cheat sheet

| User sees | Meaning |
|-----------|---------|
| `Network error: Failed to fetch` | Browser got no response (wrong API URL, CORS, backend down, mixed content `http://`) |
| `502 Bad Gateway`, empty body | Render worker crashed or timed out — check logs for **OOM** |
| `Upload failed (502): {"detail":"Database request failed."}` | App-level Supabase error (RLS, bad embedding shape, etc.) |
| `Upload failed (400): File too large...` | Over 25 MB limit |
| CORS error on `collections` | Wrong origin or `NEXT_PUBLIC_API_URL` |

---

## Key files

| File | Role |
|------|------|
| `frontend/app/dashboard/UploadPanel.tsx` | Upload + research UI |
| `backend/main.py` | FastAPI routes, CORS, upload orchestration |
| `backend/app/services/document_processor.py` | PDF parse + HF embeddings |
| `backend/app/middleware/auth.py` | JWT validation (ES256/JWKS) |
| `backend/app/services/supabase_client.py` | Supabase REST calls with user JWT |
| `docs/PHASE1.md` | Sprint log + integration gate |
| `docs/ADR-005.md` | Why HF hosted embeddings replaced local torch (Render OOM) |

---

## Demo PDF note

User's Verizon DBIR file: `c:\Users\muri\Desktop\CV Resume collection\Cybersec Resume\2025veri.pdf` — **2,832,253 bytes (~2.7 MB)**. Should work after memory optimizations deploy; if not, use executive-summary export or compress PDF.
