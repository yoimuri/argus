import os
from groq import AsyncGroq
from app.agents.state import ResearchState
from app.services.circuit_breaker import groq_breaker
from app.services.llm_json import extract_json

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"], timeout=30.0)

SYSTEM_PROMPT = (
    "You classify a research question and break it into concrete sub-queries for a "
    "document search system. Respond with JSON only, no other text, in this exact "
    "shape: {\"intent\": \"specific\"|\"broad\"|\"meta\", \"refined_queries\": [\"...\"], "
    "\"use_web\": true|false}.\n\n"
    "- \"specific\": the question already names a concrete topic, figure, or entity "
    "(example: \"What was Q3 revenue?\"). refined_queries should contain just that one "
    "question, unchanged.\n"
    "- \"broad\": the question asks about a general topic without one sharp focus "
    "(example: \"What are the risks mentioned in this document?\"). refined_queries "
    "should contain 2-3 sub-questions sampling different angles of the topic.\n"
    "- \"meta\": the question is vague or asks about the document as a whole with no "
    "real topic (examples: \"summarize this for me\", \"summarize for me\", \"what's the "
    "gist\", \"give me an overview\"). refined_queries should contain 3 sub-questions "
    "covering different likely parts of a document (overview/purpose, key findings or "
    "figures, conclusions or next steps) so retrieval samples broadly instead of landing "
    "on one arbitrary spot.\n\n"
    "Punctuation is not a signal. A trailing question mark does not make a query "
    "'specific', and a missing one does not make it 'meta' — judge intent only by "
    "whether the wording names a concrete topic. \"summarize for me\" and "
    "\"summarize for me?\" must be classified identically.\n\n"
    "\"use_web\": true only when the question is very unlikely to be answerable from an "
    "uploaded document alone — it asks about something current/recent (today's date, "
    "this week's news, the latest version of something), or general real-world knowledge "
    "that a report or PDF would not contain (e.g. \"who is the current CEO of X\", "
    "\"what's the latest CVE for Y\"). Default to false: a question about the document's "
    "own subject matter, even a broad or meta one, should stay false — searching the web "
    "costs real time and money, only ask for it when the document plausibly cannot answer "
    "on its own.\n\n"
    "Always return at least one refined query. Never include commentary, markdown, or "
    "text outside the JSON object."
)


async def orchestrator_node(state: ResearchState) -> dict:
    query = state["query"]

    async def _classify():
        completion = await _client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            max_tokens=1024,
            # Same reasoning-model trap as the synthesizer (see synthesizer.py): the
            # hidden reasoning tokens and the JSON output share the max_tokens budget.
            # At the old 300 with uncapped reasoning, a long reasoning pass could leave
            # no room for the JSON, producing empty content -> _extract_json fails ->
            # fail-open to raw query.
            #
            # Raised 768 -> 1024 (Sprint 3b): live-tested and caught the SAME failure
            # mode recurring after the use_web addition below grew the system prompt by
            # a full paragraph, which measurably increased how often reasoning ran long
            # enough to truncate the JSON mid-object (JSONDecodeError, fail-open to
            # use_web=False regardless of whether the web was actually needed). Two of
            # four live test runs hit this the same day the field was added. The lesson
            # from every prior instance of this bug applies again: any time a
            # reasoning-model prompt grows, the token budget needs headroom bumped
            # defensively, not just left alone because the added field "looks small."
            #
            # 'medium' (not 'low'): terse/lazy inputs with no few-shot match (e.g. a
            # bare "summarize", no punctuation, no named topic) need actual judgment,
            # not just pattern-matching the examples in SYSTEM_PROMPT. 'low' was too
            # tight a leash for that. This reopens the original variability (reasoning
            # can swing, same as the pre-fix default effort did). Worst
            # case if reasoning still overruns: _extract_json fails and the except
            # block below fails open to a raw-query pass, same as any other Orchestrator
            # failure. It does not reproduce the Synthesizer's blank-answer bug.
            extra_body={"reasoning_effort": "medium"},
        )
        return completion.choices[0].message.content

    try:
        raw = await groq_breaker.call(_classify)
        parsed = extract_json(raw)
        intent = parsed.get("intent")
        refined_queries = parsed.get("refined_queries")

        if intent not in ("specific", "broad", "meta"):
            raise ValueError(f"unexpected intent value: {intent!r}")
        if not isinstance(refined_queries, list):
            raise ValueError("refined_queries is not a list")

        refined_queries = [str(q).strip() for q in refined_queries if str(q).strip()]
        if not refined_queries:
            raise ValueError("refined_queries empty after cleaning")

        # bool(...) rather than a strict isinstance check: some Groq JSON responses
        # come back with "true"/"false" as strings despite the prompt's exact-shape
        # instruction. Missing key defaults to False (conservative — a parse gap
        # must not silently widen the request to the web).
        use_web = bool(parsed.get("use_web", False))

        print(f"[ARGUS] orchestrator intent={intent!r} refined_queries={refined_queries!r} "
              f"use_web={use_web}")
        return {
            "intent": intent,
            "refined_queries": refined_queries,
            "use_web": use_web,
            "trace_detail": f"intent={intent}, {len(refined_queries)} refined queries, use_web={use_web}",
        }

    except Exception as err:
        # Fail-open: the Orchestrator improving retrieval must never block it. Any
        # failure here (Groq down, breaker open, bad/unparseable JSON) falls back to
        # exactly the pre-Phase-3 behavior — one raw-query retrieval pass. use_web
        # defaults to False here too: a broken Orchestrator must not widen the
        # request to an untrusted external source.
        print(f"[ARGUS] orchestrator fallback to raw query: {err!r}")
        return {
            "intent": "specific",
            "refined_queries": [query],
            "use_web": False,
            "trace_detail": f"fallback to raw query: {err!r}"[:200],
            "trace_status": "fallback",
        }
