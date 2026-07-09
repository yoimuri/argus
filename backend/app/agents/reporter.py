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
    web_snippets = state.get("web_snippets") or []
    badge = _confidence_section(state.get("confidence_flags") or [], state.get("loop_count", 0))

    # Only shown when web search was actually wanted but couldn't happen
    # (Tavily down/unconfigured) — not when the Orchestrator judged it
    # unnecessary (web_status stays "not_run", no banner, nothing to explain).
    banner = ""
    if state.get("web_status") == "unavailable":
        banner = ("\n*Live web search was unavailable for this run — answering from your "
                   "documents only.*\n")

    source_lines = [f"- Chunk {c['chunk_index']} (id: {c['id']})" for c in chunks]
    seen_urls = set()
    for s in web_snippets:
        url = s.get("url") or ""
        if url in seen_urls:
            continue
        seen_urls.add(url)
        title = s.get("title") or url or "web result"
        source_lines.append(f"- [{title}]({url})" if url else f"- {title}")

    if not source_lines:
        report = f"## Answer\n\n{answer}\n{banner}{badge}"
        return {"report": report, "trace_detail": f"report length {len(report)} chars, no sources"}

    sources = "\n".join(source_lines)
    # Sprint 4.1 (D6): banner moves right after the answer instead of sitting
    # between Sources and Confidence -- it explains something about how the
    # answer was produced (web search unavailable), not about the sources
    # list, so it read oddly stuck below a Sources heading. report.ts
    # (frontend, Sprint 4.3) tolerates both orders for older stored sessions.
    if banner:
        report = f"## Answer\n\n{answer}\n{banner}\n## Sources\n\n{sources}\n{badge}"
    else:
        report = f"## Answer\n\n{answer}\n\n## Sources\n\n{sources}\n{badge}"
    return {
        "report": report,
        "trace_detail": f"report length {len(report)} chars, {len(web_snippets)} web sources",
    }
