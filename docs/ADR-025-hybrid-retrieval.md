# ADR-025 — Hybrid retrieval, context budget, and honest ingestion

**Status:** 🟡 Code-complete 2026-08-01, not yet live-verified
**Supersedes retrieval tuning in:** Sprint 3a.1 (multi-query fan-out), 2026-07-13 (meta breadth)

## Context — the reported failure

Live findings (Clint, 2026-08-01, after a week of real use):

1. Documents that are **not** thematic reports — a resume, a 1000+ row student list — got poor
   answers even when the question was reworded. Summaries ("what is this file about") worked; asking
   for anything specific inside them did not.
2. The agents sometimes returned **low confidence, or no answer at all**, and asking "what's in the
   file" showed it had not read all of it.
3. **Multiple documents in one collection made it worse.**

His own framing was accurate: *"kinda like my thesis mistake where it's good on trained data but bad
on other examples."* Nothing here is trained on the DBIR — but the retrieval was **tuned for
documents shaped like the DBIR**, which produces the same symptom.

## What was actually wrong (four causes)

### 1. The context window was tiny and fixed-size
`SPECIFIC_MATCH_COUNT = 5`, `BROAD_MATCH_COUNT = 8`, `FINAL_TOP_N = 8`. Eight 800-char chunks is
~6.4k characters, *regardless of collection size*. Measured against the live database:

| collection | documents | chunks | old retrieval saw |
|---|---|---|---|
| largest | 3 | **781** | 8 chunks = **~1.0%** |
| single big doc | 1 | **709** | 8 chunks = **~1.1%** |

A thematic report survives 1% sampling because its answer is concentrated and topically distinctive.
A roster does not: the answer is spread over hundreds of near-identical rows.

### 2. No per-document fairness
`match_count` was a flat top-N over the whole collection, so the one document that talked most about
the topic could win *every* slot and the rest of the collection was invisible. This is precisely the
reported "upload multiple docs and it stops answering properly."

### 3. Semantic-only search cannot retrieve exact terms
Search was 100% pgvector cosine similarity over `all-MiniLM-L6-v2` embeddings. Embeddings are strong
at *"chunks about breach causes"* and weak at *"the chunk containing the literal string 'Maria
Santos' / 'EMP-4471' / '2024-03-12'"*. In a thousand-row roster every row is semantically
near-identical, so cosine similarity cannot separate the row asked about from the 999 others.
Resumes, rosters, invoices and logs expose this immediately; thematic reports hide it.

### 4. Chunks were too big for the embedding model on dense text
`CHUNK_SIZE = 800` chars vs. `all-MiniLM-L6-v2`'s hard **256 word-piece** limit, beyond which it
**truncates silently**. 800 chars of prose ≈ 200 tokens (fits). 800 chars of *dense* text — table
rows, names, IDs — tokenizes far higher, because names/numbers/codes fragment into several
word-pieces each. Those chunks were embedded from their first ~256 tokens only: the tail of every
dense chunk was unsearchable while still occupying a chunk slot.

### Bonus bug found in the live data — "ready" with zero chunks
The database held documents with `status='ready'` and **0 chunks** (e.g. `2025veri.pdf`,
`Sample Incident_poisoned.pdf`). `upload_document` PATCHed `status='ready'` unconditionally after
the batch loop, even when nothing was indexed. "Ready" is a promise the document is searchable; with
no chunks it is invisible to retrieval, so every question about it returns "not found in the
documents" *while the UI insists the file is fine* — which reads as "the AI is broken."
Usual cause: a scanned / image-only PDF (PyMuPDF extracts no text from pictures of text; reading
those needs OCR/vision, which is Sprint 4.6c and not built).

## Decision

### Hybrid retrieval (migration 021)
Run semantic **and** keyword search, fuse with **Reciprocal Rank Fusion**.

- `content_tsv` — a `GENERATED ALWAYS ... STORED` tsvector column (Postgres maintains it on every
  insert/update; existing rows populate the moment the migration runs) + a GIN index.
- `hybrid_match_chunks()` — pgvector cosine list ∪ full-text list, fused by
  `score = Σ weight/(k + rank)`, k=60.
- **Why RRF rather than blending raw scores:** a cosine similarity (0..1) and a `ts_rank_cd`
  (unbounded, corpus-dependent) are not on comparable scales. Normalizing them requires constants
  that drift per corpus; ranks are comparable by construction.
- **Why `websearch_to_tsquery`:** it parses arbitrary user text (quotes, `OR`, `-negation`) without
  throwing, unlike `to_tsquery`. A query with no usable terms yields an empty tsquery, the keyword
  CTE is empty, and fusion degrades to semantic-only — intended behaviour, not an error.
- Candidate pools are `max(match_count * 4, 40)` per side so fusion has enough of each list to
  actually reorder.
- Security is unchanged: same `collection_id` join + `user_id = auth.uid()` filter as
  `match_document_chunks`, and **not** `SECURITY DEFINER`, so caller RLS still applies.

### Context budget (owner decision: "balanced")
`FINAL_TOP_N` 8 → **22** (meta 14 → **26**), sized against **Groq's free-tier 8,000 tokens/minute**
meter: 22 × ~600 chars ≈ 13k chars ≈ 3.3k tokens of context, leaving room for the system prompt, the
question, `max_tokens=1024` of output, and the critic pass. Deliberately *not* maxed — exceeding the
per-minute meter makes a question fail **silently** (SDK backoff), which is a worse bug than the one
being fixed. Rejected alternative: 32–40 chunks (better recall, but one rapid follow-up question
would trip the meter mid-demo).

The synthesizer additionally enforces a hard **20,000-character** context ceiling. Until now it
concatenated whatever the retriever returned with no limit — safe only by accident at 8 chunks.
Chunks are dropped from the tail (retriever hands them over in relevance order, lead chunks first),
so a trim always sheds the least relevant material.

### Per-document fairness
No single document may occupy more than `MAX_DOC_SHARE = 0.6` of the final context **when the
collection holds 2+ documents**, with a reserve backfill so a collection where only one document is
relevant still fills its context (starving the context to enforce fairness would be worse than
dominance). Lead chunks are exempt — they are one-per-document by construction.

### Chunking retune
`CHUNK_SIZE` 800 → **600** (fits the 256-token window with margin even for dense text);
`CHUNK_OVERLAP` 100 → **150** (~25%, the usual recommendation for record-like content, so a table
row split mid-record appears intact in at least one chunk).

**This applies at ingest time only.** Documents already uploaded keep their old 800-char chunks
until re-uploaded.

### Honest prompting
- **Orchestrator** gained explicit rules for *structured/list* documents: a **lookup** question keeps
  the distinctive literal terms (name/ID/code) **verbatim** in `refined_queries` — paraphrasing
  "Maria Santos" into "information about a student" destroys the only signal the keyword half can
  match — and a **counting/whole-list** question is classified `meta` for maximum breadth.
- **Synthesizer** gained a *partial view* rule: the chunks are a search result, not the whole
  document, so it must not state totals/counts/completeness as fact unless the context itself states
  them, and must not claim something is absent from the document on the basis of excerpts. A lookup
  that *is* present in the excerpts is still answered directly and confidently.

This last point is a **correctness guard**: without it, wider retrieval makes the model *more*
likely to confidently answer "there are 47 students" after seeing 22 rows of 1,000.

### Ingestion honesty
A document that produces **0 chunks** is now marked `failed` with a specific, actionable reason
(scanned/image-only PDF vs. everything quarantined as malicious) instead of `ready`.

## Consequences

- **Better:** exact-term lookups (names, IDs, dates) become possible at all; large and multi-document
  collections are sampled ~3× wider and fairly; dense text is fully embedded; unreadable uploads say
  so instead of silently pretending to work.
- **Cost:** ~3× more context tokens per question (still inside the free-tier meter by design);
  slightly more chunks per document at ingest (600 vs 800 chars); one migration to paste.
- **Deploy-order safe:** `retriever.py` calls `hybrid_match_chunks` and falls back to
  `match_document_chunks` on any failure, logging which path ran (`mode=hybrid|semantic`). The code
  can ship before the migration is pasted and simply behaves as before until it is.
- **Not fixed here:** reading text inside images (OCR/vision) is Sprint 4.6c. Documents that are
  pictures of text still cannot be answered — they now *say* so.

## Verification (all 🟡 until live)

See `docs/GO-LIVE-CHECKLIST.md` Stage R. In short: re-upload a list-type document and a resume, then
confirm (a) an exact-name lookup finds the right row, (b) a counting question gives an honest
partial-view answer rather than an invented total, (c) a multi-document collection draws chunks from
more than one document (the trace now reports `N chunks from M document(s)`), (d) the trace reports
`hybrid` search, and (e) a scanned PDF is rejected with the readable-text message.
