from app.agents.state import ResearchState


async def reporter_node(state: ResearchState) -> dict:
    chunks = state["chunks"]
    answer = state["answer"]

    if not chunks:
        report = f"## Answer\n\n{answer}\n"
        return {"report": report, "trace_detail": f"report length {len(report)} chars, no sources"}

    sources = "\n".join(f"- Chunk {c['chunk_index']} (id: {c['id']})" for c in chunks)
    report = f"## Answer\n\n{answer}\n\n## Sources\n\n{sources}\n"
    return {"report": report, "trace_detail": f"report length {len(report)} chars"}
