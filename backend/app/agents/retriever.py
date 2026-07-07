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

        for row in rows:
            row_id = row.get("id")
            if row_id in seen_ids:
                continue
            seen_ids.add(row_id)
            merged.append(row)

    merged.sort(key=lambda r: r.get("similarity", 0), reverse=True)

    return {"chunks": merged[:FINAL_TOP_N]}
