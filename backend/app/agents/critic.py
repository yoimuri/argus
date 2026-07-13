import os
import re
from groq import AsyncGroq
from app.agents.state import ResearchState
from app.services.circuit_breaker import groq_breaker
from app.services.llm_json import extract_json, call_reasoning_json

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"], timeout=30.0)

# Sprint 3a.3: re-running the retriever with identical refined_queries returns
# identical chunks, so a retry only fires when the Critic supplies novel
# gap-targeted queries — the Critic tells the Retriever what was missing, so
# the second search pass looks for exactly that. Originals + gap queries cap
# at MAX_TOTAL_QUERIES so a retry pass can't balloon the retriever's fan-out.
MAX_TOTAL_QUERIES = 5

# Deterministic backstop for the Critic's own "mark low if the draft is a
# refusal" rule (see SYSTEM_PROMPT). That rule alone isn't reliable — live
# testing (2026-07-08) showed the SAME refusal answer graded "high" on one
# run and "low" on another, since it's an LLM judgment call, not a fixed
# check. Same pattern already used for the injection guard
# (injection_patterns.py backs its LLM classifier with regex): the model's
# judgment stays primary, this only catches the case where it contradicts its
# own stated rule. Scoped to the confidence badge only — it does not force a
# retry, since a real retry needs the model's own gap-targeted queries to
# search for, which a regex can't generate.
REFUSAL_PATTERNS = [
    # Strongest single signal: the Synthesizer's system prompt tells it to
    # "say so plainly" when context is lacking, and in practice it opens a
    # refusal with this almost every time — live-confirmed across both
    # observed refusal wordings ("...does not include A SPECIFIC PERCENTAGE"
    # and "...does not include ENOUGH INFORMATION", neither of which the
    # narrower patterns below would both catch on their own).
    r"i.?m\s+sorry,?\s+but",
    r"does\s+not\s+(include|contain|specify|mention|provide)\s+(a\s+|the\s+|any\s+|enough\s+|sufficient\s+|specific\s+)?information",
    r"doesn.?t\s+(include|contain|specify|mention|provide)\s+(a\s+|the\s+|any\s+|enough\s+|sufficient\s+|specific\s+)?information",
    r"no\s+relevant\s+information\s+was\s+found",
    r"not\s+(mentioned|stated|specified|found)\s+in\s+(the|this|any)\s+(provided\s+)?context",
    r"(unable|cannot)\s+to\s+determine",
]
_COMPILED_REFUSAL_PATTERNS = [re.compile(p, re.IGNORECASE) for p in REFUSAL_PATTERNS]


def _looks_like_refusal(answer: str) -> bool:
    return any(p.search(answer) for p in _COMPILED_REFUSAL_PATTERNS)

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
    # Sprint 3b: graded alongside chunks so a web-grounded claim doesn't get
    # falsely flagged unsupported just because it's not in state["chunks"].
    web_snippets = state.get("web_snippets") or []
    loop_count = state.get("loop_count", 0)
    # .get default above means even if seeding is ever missed, the cap in
    # graph.py's router still holds — there is no path to an infinite loop.
    base = {"loop_count": loop_count + 1}

    if state.get("intent") == "meta":
        # 2026-07-13 (ADR-015 revision): no self-check for summarize/overview
        # queries — not just no retry (graph.py), no Groq call at all. A
        # full-document summary generalizes past any handful of retrieved
        # chunks by nature, so chunk-level grounding always grades it "low"
        # (observed live: low → retry → low, ~18s wasted) while telling the
        # user nothing true about the summary's quality. Empty flags render
        # honestly as "Not assessed" in the reporter. This also saves the
        # critic's ~3k tokens from the per-minute Groq budget on every
        # summary run.
        return {
            **base,
            "confidence_flags": [],
            "needs_retry": False,
            "trace_detail": "skipped: chunk-level self-check not applicable to a full-document summary",
        }

    if (not chunks and not web_snippets) or not answer:
        # Nothing to grade (no chunks/web snippets, or every chunk was
        # flagged by the injection scan). A retry can't help without gap
        # information to search for, so fall through to the reporter.
        return {
            **base,
            "confidence_flags": [],
            "needs_retry": False,
            "trace_detail": "skipped: no chunks/web snippets or empty answer",
            "trace_status": "fallback",
        }

    context_parts = [f"[Chunk {c['chunk_index']}] {c['content']}" for c in chunks]
    context_parts += [
        f"[Web result | {s.get('url') or 'unknown'}] {s['content']}" for s in web_snippets
    ]
    context = "\n\n".join(context_parts)

    try:
        # Token-budget/truncation handling now lives in call_reasoning_json
        # (see llm_json.py) -- one retry at lower effort, ReasoningTruncated
        # if still cut off. max_tokens=1536 and effort='medium' unchanged
        # (a judgment task like this needs a budget large enough that a long
        # reasoning pass can't starve the JSON). Any failure here, including
        # ReasoningTruncated, falls into the except block below and fails
        # open -- a broken Critic must never block the report.
        raw = await call_reasoning_json(
            _client, groq_breaker,
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content":
                    f"Question: {state['query']}\n\nContext:\n{context}\n\nDraft answer:\n{answer}"},
            ],
            max_tokens=1536,
            reasoning_effort="medium",
        )
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

        if _looks_like_refusal(answer) and not any(not f["grounded"] for f in flags):
            # The model's own flags say this refusal is fully grounded —
            # contradicts its own system prompt's refusal rule. Override the
            # badge, not the model: append an ungrounded flag so the report
            # never shows High confidence on an answer that admits it
            # couldn't answer the question.
            flags.append({
                "section": "overall",
                "grounded": False,
                "note": "Answer states the retrieved context lacks this information.",
            })

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
