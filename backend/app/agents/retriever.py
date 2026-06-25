from app.services.document_processor import embed_query
from app.services.supabase_client import supabase_request
from app.agents.state import ResearchState


async def retriever_node(state: ResearchState) -> dict:
    print(f"--- DEBUG RETRIEVER: Starting search for collection {state['collection_id']} ---")
    
    query_embedding = await embed_query(state["query"])
    print(f"--- DEBUG RETRIEVER: Query embedded successfully. Length: {len(query_embedding)} ---")

    try:
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
        print(f"--- DEBUG RETRIEVER: Database returned {len(rows) if rows else 0} chunks ---")
        if rows:
            print(f"--- DEBUG RETRIEVER: First chunk ID: {rows[0].get('id', 'NO ID')} ---")
    except Exception as e:
        print(f"--- DEBUG RETRIEVER ERROR: Database call failed! ---")
        print(f"--- DEBUG RETRIEVER ERROR: {type(e).__name__}: {e} ---")
        rows = []

    return {"chunks": rows}