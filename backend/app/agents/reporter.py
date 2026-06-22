from app.agents.state import ResearchState


async def reporter_node(state: ResearchState) -> dict:
    chunks = state["chunks"]
    answer = state["answer"]

    if not chunks:
        return {"report": f"## Answer\n\n{answer}\n"}

    sources = "\n".join(f"- Chunk {c['chunk_index']} (id: {c['id']})" for c in chunks)
    return {"report": f"## Answer\n\n{answer}\n\n## Sources\n\n{sources}\n"}
