import os
from groq import AsyncGroq
from app.agents.state import ResearchState
from app.services.circuit_breaker import groq_breaker
from app.services.llm_json import extract_json

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"], timeout=30.0)

# Sprint 3a.3: re-running the retriever with identical refined_queries returns
# identical chunks, so a retry only fires when the Critic supplies novel
# gap-targeted queries — the Critic tells the Retriever what was missing, so
# the second search pass looks for exactly that. Originals + gap queries cap
# at MAX_TOTAL_QUERIES so a retry pass can't balloon the retriever's fan-out.
MAX_TOTAL_QUERIES = 5

SYSTEM_PROMPT = (
    "You are a fact-checker for a document research system. You receive the "
    "user's question, numbered context chunks, and a draft answer. Judge only "
    "whether the draft is supported by the chunks. Respond with JSON only, no "
    "other text, in this exact shape: {\"confidence\": \"high\"|\"low\", "
    "\"flags\": [{\"section\": \"...\", \"grounded\": true|false, \"note\": \"...\"}], "
    "\"retry_queries\": [\"...\"]}.\n\n"
    "\"flags\" must always contain at least one entry. If every claim in the "
    "draft is supported, return exactly one entry with \"grounded\": true "
    "noting that. Mark \"confidence\" as \"low\" if any claim in the draft "
    "lacks support in the chunks, OR if the draft itself says the context does "
    "not contain enough information to answer the question.\n\n"
    "When \"confidence\" is \"low\", \"retry_queries\" must contain 1-2 short, "
    "concrete search queries that target exactly the missing information. "
    "When \"confidence\" is \"high\", \"retry_queries\" must be an empty list.\n\n"
    "Never include commentary, markdown, or text outside the JSON object."
)


async def critic_node(state: ResearchState) -> dict:
    answer = (state.get("answer") or "").strip()
    chunks = state.get("chunks") or []
    loop_count = state.get("loop_count", 0)
    # .get default above means even if seeding is ever missed, the cap in
    # graph.py's router still holds — there is no path to an infinite loop.
    base = {"loop_count": loop_count + 1}

    if not chunks or not answer:
        # Nothing to grade (no-chunks fallback answer, or every chunk was
        # flagged by the injection scan). A retry can't help without gap
        # information to search for, so fall through to the reporter.
        return {
            **base,
            "confidence_flags": [],
            "needs_retry": False,
            "trace_detail": "skipped: no chunks or empty answer",
            "trace_status": "fallback",
        }

    context = "\n\n".join(f"[Chunk {c['chunk_index']}] {c['content']}" for c in chunks)

    async def _grade():
        completion = await _client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content":
                    f"Question: {state['query']}\n\nContext:\n{context}\n\nDraft answer:\n{answer}"},
            ],
            max_tokens=1536,
            # Same reasoning-model trap as orchestrator.py/synthesizer.py: hidden
            # reasoning tokens share max_tokens with the visible JSON. 'medium'
            # effort for a judgment task like this, with a budget large enough
            # that a long reasoning pass can't starve the JSON. Worst case if it
            # still does: extract_json raises below and the except block fails
            # open — a broken Critic must never block the report.
            extra_body={"reasoning_effort": "medium"},
        )
        return completion.choices[0].message.content

    try:
        raw = await groq_breaker.call(_grade)
        parsed = extract_json(raw)

        confidence = parsed.get("confidence")
        if confidence not in ("high", "low"):
            raise ValueError(f"unexpected confidence value: {confidence!r}")

        flags = parsed.get("flags")
        if not isinstance(flags, list) or not flags:
            raise ValueError("flags missing or empty")
        flags = [
            {
                "section": str(f.get("section", "overall"))[:120],
                "grounded": bool(f.get("grounded", True)),
                "note": str(f.get("note", ""))[:200],
            }
            for f in flags if isinstance(f, dict)
        ][:8]
        if not flags:
            raise ValueError("flags empty after sanitizing")

        retry_queries = [
            str(q).strip() for q in (parsed.get("retry_queries") or [])
            if str(q).strip()
        ][:2]

        originals = state.get("refined_queries") or [state["query"]]
        new_queries = [q for q in retry_queries if q not in originals]
        needs_retry = confidence == "low" and bool(new_queries)

        result = {
            **base,
            "confidence_flags": flags,
            "needs_retry": needs_retry,
            "trace_detail": f"confidence={confidence}, {len(flags)} flags, retry={needs_retry}",
        }
        if needs_retry:
            # Chunks are replaced (not appended) on the retry retriever pass —
            # this just controls what it searches for.
            result["refined_queries"] = (originals + new_queries)[:MAX_TOTAL_QUERIES]
        return result

    except Exception as err:
        # Fail-open, same stance as the orchestrator: a broken Critic must
        # never block the report.
        print(f"[ARGUS] critic fail-open: {err!r}")
        return {
            **base,
            "confidence_flags": [],
            "needs_retry": False,
            "trace_detail": f"fail-open: {err!r}"[:200],
            "trace_status": "fallback",
        }
