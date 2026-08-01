-- 022_keyword_search_fix.sql — fix the keyword half of hybrid retrieval.
-- Sprint 4.8 fix batch, ADR-025 revision 2.
--
-- THE BUG (live-proven 2026-08-01, on a real 2,000-student seating list):
-- asking "what is the seat number of <name>" returned "no entry for that
-- individual" even though the row was present and correctly extracted.
--
-- Root cause: migration 021's keyword CTE used
--     content_tsv @@ websearch_to_tsquery('english', query_text)
-- and websearch_to_tsquery ANDs every term together. The natural question
-- "what is the seat number of MALUBAY Jay-ar Hizon" becomes
--     'what' & 'seat' & 'number' & 'malubay' & 'jay' & 'ar' & 'hizon'
-- and NO single chunk contains all of those words — the chunk holding the name
-- does not also contain the words "seat"/"number". Measured on the live
-- document: natural question -> 0 matching chunks; the bare name -> 2. So the
-- keyword half contributed NOTHING for exactly the queries it exists to serve,
-- retrieval silently degraded to semantic-only, and semantic search cannot
-- separate one student row from 2,000 near-identical ones. The user got an
-- honest but wrong "not found".
--
-- Secondary defect: ts_rank_cd scored the correct chunk equal to wrong ones
-- (0.1 vs 0.1) because it does not weight by term rarity — common boilerplate
-- ("Row", "Column", "Green", "SGS") counted as much as a rare surname.
--
-- THE FIX, validated read-only against the live data before writing:
--   1. OR semantics: match a chunk if it contains ANY query term.
--   2. IDF-style rarity weighting: score each chunk by the summed rarity of the
--      query terms it contains, where rarity = ln(total_chunks / chunks
--      containing that term). A surname appearing in 1 of 321 chunks scores
--      ~5.8; "row", appearing in all of them, scores ~0. Rare terms therefore
--      dominate, which is precisely the behaviour a name/ID lookup needs.
--      Measured on the live document: correct chunk 22.7 vs 6.4 for the best
--      wrong chunk — decisive separation where ts_rank_cd tied at 0.1.
--
-- Everything stays additive and idempotent; hybrid_match_chunks keeps the same
-- signature, so no application change is required for the function swap.

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
-- Every chunk the caller is allowed to see, scoped exactly as before: the
-- collection join plus user_id = auth.uid(). NOT security definer, so RLS still
-- applies on top.
scope as (
  select dc.id, dc.document_id, dc.content, dc.chunk_index, dc.content_tsv, dc.embedding
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.collection_id = match_collection_id
    and dc.user_id = auth.uid()
),
-- Distinct lexemes of the QUESTION, produced by the same analyzer that built
-- content_tsv, so stemming and stop-word removal match exactly. Stop-words
-- ("what", "is", "the", "of") are dropped here by to_tsvector itself.
qterms as (
  select distinct lexeme
  from unnest(to_tsvector('english', coalesce(query_text, ''))) as t(lexeme)
),
corpus as (select greatest(count(*), 1)::float as n from scope),
-- Rarity weight per query term. A term in every chunk contributes ~0; a term in
-- one chunk of 321 contributes ~5.8. greatest(...,1) avoids division by zero
-- for a term that appears nowhere.
idf as (
  select q.lexeme,
         ln( (select n from corpus)
             / greatest(1, (select count(*) from scope s where s.content_tsv @@ q.lexeme::tsquery)) ) as weight
  from qterms q
),
keyword as (
  select s.id,
         row_number() over (order by sum(i.weight) desc) as rank
  from scope s
  join idf i on s.content_tsv @@ i.lexeme::tsquery
  group by s.id
  order by sum(i.weight) desc
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
)
select
  s.id,
  s.document_id,
  s.content,
  s.chunk_index,
  coalesce(f.sim, 0.0)::float as similarity
from fused f
join scope s on s.id = f.id
order by f.score desc
limit match_count;
$$;

grant execute on function public.hybrid_match_chunks to authenticated;
