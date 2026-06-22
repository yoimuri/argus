create or replace function match_document_chunks(
  query_embedding vector(384),
  match_collection_id uuid,
  match_count int default 5
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
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    document_chunks.chunk_index,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  join documents on documents.id = document_chunks.document_id
  where documents.collection_id = match_collection_id
    and document_chunks.user_id = auth.uid()
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function match_document_chunks to authenticated;
