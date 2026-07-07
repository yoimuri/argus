-- 007_hnsw_vector_index.sql — replace the ivfflat ANN index with HNSW.
--
-- Why: during Sprint 3a.1 live testing (2026-07-08) retrieval intermittently
-- returned zero chunks for valid queries ("summarize" failed, "summary" worked,
-- seemingly at random). The RPC and the embeddings were both fine; the cause was
-- THIS table's approximate index. The original index (migration 001) was:
--     using ivfflat (embedding vector_cosine_ops) with (lists = 100)
-- ivfflat buckets vectors into `lists` clusters and, at the default
-- ivfflat.probes = 1, scans only the single nearest cluster per query. On a small
-- collection the chunks are spread thinly across 100 lists, so most lists are
-- empty; a query whose vector lands on an empty list returns nothing. Different
-- query phrasings probe different lists, which is why the same collection returned
-- 0, 1, 1 rows for three sub-queries in one request, and why vague queries failed
-- while specific ones (which co-cluster with their answer chunk) worked.
--
-- Fix: HNSW. Its default recall is near-exact with no lists/probes to tune, and it
-- behaves correctly on small datasets. `lists = 100` was a large-dataset setting
-- (rule of thumb ~rows/1000) mistakenly applied to a small one.
--
-- Requires pgvector >= 0.5.0 (Supabase has this). vector_cosine_ops matches the
-- `<=>` cosine-distance operator used in match_document_chunks, so the RPC is
-- unchanged — only the index it can use changes.

drop index if exists document_chunks_embedding_idx;

create index document_chunks_embedding_idx
  on document_chunks
  using hnsw (embedding vector_cosine_ops);
