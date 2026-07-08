from app.agents.state import ResearchState


def _confidence_section(flags: list[dict], loop_count: int) -> str:
    """Pure string formatting, no LLM call — the badge is a summary of what the
    Critic already decided, not a new judgment. Empty flags unambiguously means
    the Critic was skipped or failed open (a successful run always returns at
    least one flag, see critic.py), so rendering "Not assessed" instead of a
    default "High" avoids overclaiming confidence that was never actually checked.
    """
    retried = " One automatic re-retrieval pass was performed." if loop_count >= 2 else ""

    if not flags:
        return "\n## Confidence\n\nNot assessed (self-check unavailable for this run).\n"

    weak = [f for f in flags if not f.get("grounded", True)]
    if not weak:
        return ("\n## Confidence\n\nHigh — all checked sections are supported by the "
                f"retrieved sources.{retried}\n")

    notes = "\n".join(
        f"- {f.get('section', 'section')}: {f.get('note') or 'not fully supported'}"
        for f in weak
    )
    return (f"\n## Confidence\n\n⚠️ Low — {len(weak)} section(s) not fully supported by "
            f"the sources.{retried}\n\n{notes}\n")


async def reporter_node(state: ResearchState) -> dict:
    chunks = state["chunks"]
    answer = state["answer"]
    badge = _confidence_section(state.get("confidence_flags") or [], state.get("loop_count", 0))

    if not chunks:
        report = f"## Answer\n\n{answer}\n{badge}"
        return {"report": report, "trace_detail": f"report length {len(report)} chars, no sources"}

    sources = "\n".join(f"- Chunk {c['chunk_index']} (id: {c['id']})" for c in chunks)
    report = f"## Answer\n\n{answer}\n\n## Sources\n\n{sources}\n{badge}"
    return {"report": report, "trace_detail": f"report length {len(report)} chars"}
