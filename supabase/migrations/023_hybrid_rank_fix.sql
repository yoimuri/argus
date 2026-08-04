-- 023_hybrid_rank_fix.sql — make strong exact-term matches WIN the fusion.
-- Sprint 4.8 fix batch 3, ADR-025 revision 3.
--
-- THE BUG (live-proven 2026-08-04, third distinct cause of the same symptom):
-- with migrations 021+022 applied and the retriever's ranking fix deployed, a
-- name lookup on a 2,000-row seating list STILL failed. The keyword half was
-- perfect — the chunk containing "POYAOAN, Clint Branwel Dayap" ranked #1 with
-- an IDF score of 17.80 vs 4.65 for the runners-up (a ~4x margin, because it is
-- the only chunk in the document containing that surname).
--
-- Reciprocal Rank Fusion then threw that away. RRF scores ONLY by rank
-- position: contribution = weight/(k + rank). With k=60:
--     keyword rank 1  -> 1/61 = 0.01639
--     keyword rank 5  -> 1/65 = 0.01538
-- A 4x difference in match quality became a 6% difference in fused score. And
-- because a chunk present in BOTH lists sums two contributions, any mediocre
-- chunk that merely contains the words "seat"/"number" AND ranks well
-- semantically (e.g. keyword #6 + semantic #1 = 0.03154) BEAT the keyword-only
-- #1 (0.01639). Measured on the live document: the fused top-12 contained ZERO
-- chunks with the user's name — matching exactly the sources the app displayed.
--
-- RRF is the right default when both lists are commensurable. It is the WRONG
-- default when one list carries a rarity signal that is the entire point of the
-- query: for "find this specific name/ID", a chunk containing a term that
-- appears in 1 of 378 chunks is not "one rank better" than a chunk containing
-- "seat" — it is categorically the answer.
--
-- THE FIX: keep RRF as the general ranker, but let a DISTINCTIVE keyword match
-- pre-empt it.
--   * A query term is DISTINCTIVE when its IDF weight is high, i.e. it appears
--     in a small fraction of the collection's chunks. ln(378/1) = 5.93, while
--     a term in every chunk scores ~0. The threshold below (2.0) corresponds to
--     a term appearing in <=13.5% of chunks — rare enough to be a name, an ID,
--     or a specific code, not boilerplate.
--   * Chunks whose summed DISTINCTIVE weight clears the threshold are promoted
--     ahead of the RRF ordering, ordered by that weight. Everything else keeps
--     the existing RRF behaviour, so thematic/semantic queries are unchanged
--     (no query term is distinctive in a "what are the main findings" question,
--     so the promotion set is empty and this is a no-op).
--
-- Net effect: exact-term lookups become reliable, and every other query behaves
-- exactly as before.

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
with params as (
  select greatest(match_count * 4, 40) as pool
),
scope as (
  select dc.id, dc.document_id, dc.content, dc.chunk_index, dc.content_tsv, dc.embedding
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
    and dc.user_id = auth.uid()
),
qterms as (
  select distinct lexeme
  from unnest(to_tsvector('english', coalesce(query_text, ''))) as t(lexeme)
),
corpus as (select greatest(count(*), 1)::float as n from scope),
idf as (
  select q.lexeme,
         ln( (select n from corpus)
             / greatest(1, (select count(*) from scope s where s.content_tsv @@ q.lexeme::tsquery)) ) as weight
  from qterms q
),
-- Total IDF weight per chunk (all matching query terms).
kw_scores as (
  select s.id, sum(i.weight) as total_weight,
         -- Weight contributed ONLY by distinctive (rare) terms. A chunk
         -- matching just "seat"/"number" scores ~0 here; a chunk matching a
         -- rare surname scores high.
         sum(i.weight) filter (where i.weight >= 2.0) as rare_weight
  from scope s
  join idf i on s.content_tsv @@ i.lexeme::tsquery
  group by s.id
),
keyword as (
  select id, row_number() over (order by total_weight desc) as rank
  from kw_scores
  order by total_weight desc
  limit (select pool from params)
),
semantic as (
  select s.id,
         row_number() over (order by s.embedding <=> query_embedding) as rank,
         (1 - (s.embedding <=> query_embedding))::float as sim
  from scope s
  order by s.embedding <=> query_embedding
  limit (select pool from params)
),
fused as (
  select
    coalesce(sem.id, kw.id) as id,
    coalesce(semantic_weight / (rrf_k + sem.rank), 0.0)
      + coalesce(full_text_weight / (rrf_k + kw.rank), 0.0) as score,
    sem.sim as sim
  from semantic sem
  full outer join keyword kw on kw.id = sem.id
),
-- Final ordering: distinctive keyword hits first (by how distinctive), then
-- everything else by RRF. COALESCE keeps chunks with no rare terms in the
-- second tier, preserving current behaviour for ordinary queries.
ranked as (
  select f.id, f.sim,
         coalesce(ks.rare_weight, 0.0) as rare_weight,
         f.score
  from fused f
  left join kw_scores ks on ks.id = f.id
)
select
  s.id,
  s.document_id,
  s.content,
  s.chunk_index,
  coalesce(r.sim, 0.0)::float as similarity
from ranked r
join scope s on s.id = r.id
order by
  case when r.rare_weight >= 2.0 then 0 else 1 end,  -- distinctive hits first
  r.rare_weight desc,                                -- most distinctive first
  r.score desc                                       -- then normal RRF
limit match_count;
$$;

grant execute on function public.hybrid_match_chunks to authenticated;
