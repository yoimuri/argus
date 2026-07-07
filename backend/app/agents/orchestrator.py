import json
import os
from groq import AsyncGroq
from app.agents.state import ResearchState
from app.services.circuit_breaker import groq_breaker

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"], timeout=30.0)

SYSTEM_PROMPT = (
    "You classify a research question and break it into concrete sub-queries for a "
    "document search system. Respond with JSON only, no other text, in this exact "
    "shape: {\"intent\": \"specific\"|\"broad\"|\"meta\", \"refined_queries\": [\"...\"]}.\n\n"
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
    "Always return at least one refined query. Never include commentary, markdown, or "
    "text outside the JSON object."
)


def _extract_json(raw: str) -> dict:
    """Best-effort JSON parse. Some models wrap the object in a markdown code
    fence or add a stray sentence before/after it even when told not to — strip
    a fence and fall back to the first {...} substring before giving up, rather
    than treating cosmetic wrapping as a hard failure."""
    text = raw.strip()

    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(text[start:end + 1])


async def orchestrator_node(state: ResearchState) -> dict:
    query = state["query"]

    async def _classify():
        completion = await _client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": query},
            ],
            max_tokens=300,
        )
        return completion.choices[0].message.content

    try:
        raw = await groq_breaker.call(_classify)
        parsed = _extract_json(raw)
        intent = parsed.get("intent")
        refined_queries = parsed.get("refined_queries")

        if intent not in ("specific", "broad", "meta"):
            raise ValueError(f"unexpected intent value: {intent!r}")
        if not isinstance(refined_queries, list):
            raise ValueError("refined_queries is not a list")

        refined_queries = [str(q).strip() for q in refined_queries if str(q).strip()]
        if not refined_queries:
            raise ValueError("refined_queries empty after cleaning")

        print(f"[ARGUS] orchestrator intent={intent!r} refined_queries={refined_queries!r}")
        return {"intent": intent, "refined_queries": refined_queries}

    except Exception as err:
        # Fail-open: the Orchestrator improving retrieval must never block it. Any
        # failure here (Groq down, breaker open, bad/unparseable JSON) falls back to
        # exactly the pre-Phase-3 behavior — one raw-query retrieval pass.
        print(f"[ARGUS] orchestrator fallback to raw query: {err!r}")
        return {"intent": "specific", "refined_queries": [query]}
