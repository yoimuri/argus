from app.services.document_processor import embed_query
from app.services.supabase_client import supabase_request
from app.agents.state import ResearchState


async def retriever_node(state: ResearchState) -> dict:
    query_embedding = embed_query(state["query"])

    rows = await supabase_request(
        "POST",
        "rpc/match_document_chunks",
        state["access_token"],
        json_body={
            "query_embedding": query_embedding,
            "match_collection_id": state["collection_id"],
            "match_count": 5,
        },
    )

    return {"chunks": rows}
