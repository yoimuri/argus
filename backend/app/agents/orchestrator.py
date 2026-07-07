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
    "real topic (example: \"summarize this for me\", \"what's the gist\"). "
    "refined_queries should contain 3 sub-questions covering different likely parts of "
    "a document (overview/purpose, key findings or figures, conclusions or next steps) "
    "so retrieval samples broadly instead of landing on one arbitrary spot.\n\n"
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
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        return completion.choices[0].message.content

    try:
        raw = await groq_breaker.call(_classify)
        parsed = json.loads(raw)
        intent = parsed.get("intent")
        refined_queries = parsed.get("refined_queries")

        if intent not in ("specific", "broad", "meta"):
            raise ValueError(f"unexpected intent value: {intent!r}")
        if not isinstance(refined_queries, list):
            raise ValueError("refined_queries is not a list")

        refined_queries = [str(q).strip() for q in refined_queries if str(q).strip()]
        if not refined_queries:
            raise ValueError("refined_queries empty after cleaning")

        return {"intent": intent, "refined_queries": refined_queries}

    except Exception as err:
        # Fail-open: the Orchestrator improving retrieval must never block it. Any
        # failure here (Groq down, breaker open, bad/unparseable JSON) falls back to
        # exactly the pre-Phase-3 behavior — one raw-query retrieval pass.
        print(f"[ARGUS] orchestrator fallback to raw query: {err}")
        return {"intent": "specific", "refined_queries": [query]}
