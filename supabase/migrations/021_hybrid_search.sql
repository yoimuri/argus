-- 021_hybrid_search.sql — hybrid retrieval: semantic (pgvector) + keyword
-- (Postgres full-text), fused. Sprint 4.8, ADR-025.
--
-- WHY (live findings, 2026-08-01): retrieval answered well on a DBIR-style
-- thematic report but poorly on a resume, a 1000+ row student list, and other
-- non-report documents — and got worse with several documents in one
-- collection. Three causes were found; this migration fixes the one that needs
-- the database:
--
--   PURE SEMANTIC SEARCH CANNOT DO EXACT TERMS. all-MiniLM-L6-v2 embeddings are
--   excellent at "chunks ABOUT breach causes" and weak at "the chunk containing
--   the literal string 'Maria Santos' / 'EMP-4471' / '2024-03-12'". In a list of
--   a thousand names every row is semantically near-identical, so cosine
--   similarity cannot separate the row you asked about from the 999 you didn't.
--   Thematic reports hide this (their answers are topical); rosters, resumes,
--   invoices and logs expose it immediately.
--
-- THE FIX: run BOTH searches and fuse them.
--   * semantic  — unchanged pgvector cosine search; wins on "what is this about"
--   * full-text — Postgres tsvector/GIN; wins on names, ids, codes, exact terms
--   * fusion    — Reciprocal Rank Fusion (RRF): score = sum(weight/(k + rank))
--                 over both lists. RRF is used instead of mixing the raw scores
--                 because a cosine similarity (0..1) and a ts_rank (unbounded,
--                 corpus-dependent) are not on comparable scales; normalizing
--                 them needs constants that drift per corpus, while ranks are
--                 comparable by construction. k=60 is the standard published
--                 constant — it damps any single list's top hit so one search
--                 cannot dominate the fused order.
--
-- Everything here is additive and idempotent. The existing
-- match_document_chunks() RPC is left untouched, so if the hybrid path ever
-- misbehaves the backend falls back to it with no schema change (retriever.py
-- does exactly that on exception).

-- ---------------------------------------------------------------------------
-- 1. Full-text search column + index
--    GENERATED ALWAYS: Postgres maintains it on every insert/update — no
--    backfill job, no application code to keep in sync, and rows that already
--    exist are populated the moment this runs. 'english' gives stemming
--    (student/students) and stop-word removal. GIN is the correct index type
--    for tsvector containment (@@) queries.
-- ---------------------------------------------------------------------------
alter table public.document_chunks
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

create index if not exists document_chunks_content_tsv_idx
  on public.document_chunks
  using gin (content_tsv);

-- ---------------------------------------------------------------------------
-- 2. hybrid_match_chunks() — semantic + keyword, fused with RRF.
--
--    Security: mirrors match_document_chunks exactly — the collection join plus
--    `document_chunks.user_id = auth.uid()`. NOT security definer, so the
--    caller's RLS still applies on top. A user can never reach another user's
--    chunks through it.
--
--    match_count : rows returned after fusion
--    *_weight    : lets application code lean the fusion without a new
--                  migration; the backend passes 1.0/1.0 (balanced) today
--    rrf_k       : RRF damping constant (60 = published default)
--
--    websearch_to_tsquery (not to_tsquery) parses arbitrary user text — quotes,
--    OR, -negation — without throwing. A query with no usable terms yields an
--    empty tsquery matching nothing: the keyword CTE is simply empty and fusion
--    degrades to semantic-only. That is the intended behaviour, not an error.
-- ---------------------------------------------------------------------------
create or replace function public.hybrid_match_chunks(
  query_embedding vector(384),
  query_text text,
  match_collection_id uuid,
  match_count int default 20,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  rrf_k int default 60
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  similarity float
)
language sql stable
as $$
-- Candidate pools are wider than match_count (x4, floor 40) so the fusion has
-- enough of each list to actually reorder; fusing two top-20s would mostly
-- reproduce whichever list a chunk happened to land in.
with params as (
  select greatest(match_count * 4, 40) as pool
),
semantic as (
  select
    dc.id,
    row_number() over (order by dc.embedding <=> query_embedding) as rank,
    (1 - (dc.embedding <=> query_embedding))::float as sim
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
    and dc.user_id = auth.uid()
  order by dc.embedding <=> query_embedding
  limit (select pool from params)
),
keyword as (
  select
    dc.id,
    row_number() over (
      order by ts_rank_cd(dc.content_tsv, websearch_to_tsquery('english', query_text)) desc
    ) as rank
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
    and dc.user_id = auth.uid()
    and dc.content_tsv @@ websearch_to_tsquery('english', query_text)
  order by ts_rank_cd(dc.content_tsv, websearch_to_tsquery('english', query_text)) desc
  limit (select pool from params)
),
fused as (
  select
    coalesce(s.id, k.id) as id,
    coalesce(semantic_weight / (rrf_k + s.rank), 0.0)
      + coalesce(full_text_weight / (rrf_k + k.rank), 0.0) as score,
    s.sim as sim
  from semantic s
  full outer join keyword k on k.id = s.id
)
-- Report the true cosine similarity when the semantic side saw this chunk, so
-- the app's existing "top similarity" trace stays meaningful. A keyword-only hit
-- has no cosine rank; 0.0 marks that honestly rather than inventing a score.
select
  dc.id,
  dc.document_id,
  dc.content,
  dc.chunk_index,
  coalesce(f.sim, 0.0)::float as similarity
from fused f
join document_chunks dc on dc.id = f.id
order by f.score desc
limit match_count;
$$;

grant execute on function public.hybrid_match_chunks to authenticated;
