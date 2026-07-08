from app.services.document_processor import embed_query
from app.services.supabase_client import supabase_request
from app.agents.state import ResearchState

# Sprint 3a.1: retrieval now runs once per Orchestrator-refined sub-query instead of
# once on the raw query, so a vague/meta question ("summarize for me") samples the
# document broadly instead of landing on one arbitrary top-5. Results are merged,
# deduped by chunk id, and capped so multi-query fan-out can't balloon the
# synthesizer's context.
SPECIFIC_MATCH_COUNT = 5
BROAD_MATCH_COUNT = 8
FINAL_TOP_N = 8

# Sprint 3a.2 refinement: a "meta" query ("summarize this for me") has no real
# topic, so semantic search under-samples positional info like a document's
# title/author, which lives in its opening chunk. Forcing chunk_index=0 into
# the candidate set for meta intent fixes that without touching specific/broad
# retrieval, which already have a real topic to search on. Capped so a
# multi-document collection can't crowd out relevance with lead chunks alone.
MAX_LEAD_CHUNKS = 3


async def _fetch_lead_chunks(collection_id: str, access_token: str) -> list[dict]:
    """chunk_index=0 of every document in the collection. document_chunks has no
    collection_id column, so the filter goes through the documents join; RLS still
    scopes rows to the caller. Falls back to two plain queries if the embedded
    filter syntax ever misbehaves against PostgREST."""
    try:
        rows = await supabase_request(
            "GET",
            "document_chunks"
            "?select=id,document_id,content,chunk_index,trust_level,documents!inner(collection_id)"
            f"&chunk_index=eq.0&documents.collection_id=eq.{collection_id}",
            access_token,
        )
        for row in rows:
            row.pop("documents", None)
        return rows
    except Exception as err:
        print(f"[ARGUS] retriever lead-chunk join query failed, falling back: {err!r}")

    docs = await supabase_request(
        "GET", f"documents?collection_id=eq.{collection_id}&select=id", access_token,
    )
    doc_ids = ",".join(d["id"] for d in docs)
    if not doc_ids:
        return []
    return await supabase_request(
        "GET",
        f"document_chunks?document_id=in.({doc_ids})&chunk_index=eq.0"
        "&select=id,document_id,content,chunk_index,trust_level",
        access_token,
    )


async def retriever_node(state: ResearchState) -> dict:
    refined_queries = state.get("refined_queries") or [state["query"]]
    intent = state.get("intent", "specific")
    match_count = SPECIFIC_MATCH_COUNT if intent == "specific" else BROAD_MATCH_COUNT

    seen_ids = set()
    merged = []

    for sub_query in refined_queries:
        query_embedding = await embed_query(sub_query)

        rows = await supabase_request(
            "POST",
            "rpc/match_document_chunks",
            state["access_token"],
            json_body={
                "query_embedding": query_embedding,
                "match_collection_id": state["collection_id"],
                "match_count": match_count,
            },
        )

        # Observability: dim should always be 384, and rows should be non-zero for a
        # populated collection (the RPC has no similarity threshold). If a future run
        # returns an empty answer, these two numbers say immediately whether the cause
        # was a bad embedding (wrong dim) or the RPC genuinely returning nothing.
        dim = len(query_embedding) if isinstance(query_embedding, list) else "N/A"
        print(f"[ARGUS] retriever sub_query={sub_query!r} embed_dim={dim} rows={len(rows)}")

        for row in rows:
            row_id = row.get("id")
            if row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            merged.append(row)

    merged.sort(key=lambda r: r.get("similarity", 0), reverse=True)

    lead_chunks = []
    if intent == "meta":
        candidates = await _fetch_lead_chunks(state["collection_id"], state["access_token"])
        for row in candidates:
            row_id = row.get("id")
            if row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            lead_chunks.append(row)
            if len(lead_chunks) >= MAX_LEAD_CHUNKS:
                break
        print(f"[ARGUS] retriever meta lead-chunks={len(lead_chunks)}")

    # Lead chunks go first so the top-N cap can't drop them.
    final = (lead_chunks + merged)[:FINAL_TOP_N]
    print(
        f"[ARGUS] retriever intent={intent!r} sub_queries={len(refined_queries)} "
        f"merged={len(merged)} returned={len(final)}"
    )
    top_similarity = max((r.get("similarity", 0) for r in merged), default=0)
    return {
        "chunks": final,
        "trace_detail": f"{len(final)} chunks, top similarity {top_similarity:.2f}",
    }
