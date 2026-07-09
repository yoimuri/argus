"""Sprint 3b — Web Scout: live web search via Tavily.

Design notes (see docs/ADR-017.md for the full threat model):

- **Orchestrator-gated, not always-on.** The Orchestrator sets `use_web` per
  query (does this question plausibly need current/external info a document
  wouldn't contain?). When it's False, this node returns immediately with no
  network call — no billable Tavily search, no added latency, no extra
  untrusted-input surface on a question the user's own PDF can already
  answer. This is a self-skip inside the node, not a conditional graph edge,
  so the graph stays linear.

- **Serial, not parallel with the Retriever.** `graph.py` runs
  `orchestrator -> web_scout -> retriever -> synthesizer`. The 3a Critic
  retry cycle (`synthesizer -> critic -> {retriever | reporter}`) loops back
  to the Retriever only; a parallel fan-in from both web_scout and retriever
  into the synthesizer would need a state reducer and would re-run web_scout
  (or not) inconsistently across a retry. Serial wiring sidesteps that
  entirely: web_scout runs exactly once per research call.

- **Same injection scan as document chunks, at fetch time.** Web text is
  untrusted in a different way than an uploaded PDF (arbitrary third party,
  no upload-time scan, and a model is more inclined to treat "the web says"
  as authoritative) — but the mechanical defense is the same shared regex
  used for document chunks (`injection_patterns.matches_any`), applied here
  before a snippet ever reaches the Synthesizer. A flagged snippet is
  dropped and logged, exactly like a poisoned chunk. This does not claim to
  catch every possible rephrasing — the same honest limitation already
  accepted for chunks (ADR-007/ADR-012) applies here too.

- **Fail-open, same stance as every other external call.** Tavily down,
  timing out, or simply not configured (`TAVILY_API_KEY` unset) all degrade
  to `web_status="unavailable"` and an empty snippet list — research
  continues doc-only. The reporter surfaces a one-line banner when this
  happens (see reporter.py). Never raises.
"""
import os
import httpx
from app.agents.state import ResearchState
from app.services.supabase_client import supabase_request
from app.services.injection_patterns import matches_any
from app.services.circuit_breaker import tavily_breaker, CircuitBreakerOpen

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

# One shared client for the process lifetime, same reasoning as
# supabase_client.py: avoid a new connection pool/TLS handshake per call.
_client = httpx.AsyncClient(
    base_url="https://api.tavily.com",
    timeout=httpx.Timeout(20.0, connect=5.0),
)

MAX_RESULTS = 5
MAX_SNIPPET_CHARS = 500


async def _search(query: str) -> list[dict]:
    response = await _client.post(
        "/search",
        json={"query": query, "search_depth": "basic", "max_results": MAX_RESULTS},
        headers={"Authorization": f"Bearer {TAVILY_API_KEY}"},
    )
    response.raise_for_status()
    return response.json().get("results", [])


async def web_scout_node(state: ResearchState) -> dict:
    if not state.get("use_web"):
        return {
            "web_snippets": [],
            "web_status": "not_run",
            "trace_detail": "skipped: orchestrator judged web search unnecessary",
        }

    if not TAVILY_API_KEY:
        # Distinct from a live failure below: nothing was even attempted.
        # web_status stays the same coarse "unavailable" the reporter checks
        # for, the trace_detail carries the specific reason.
        return {
            "web_snippets": [],
            "web_status": "unavailable",
            "trace_detail": "Tavily not configured (TAVILY_API_KEY unset)",
            "trace_status": "fallback",
        }

    try:
        results = await tavily_breaker.call(_search, state["query"])
    except CircuitBreakerOpen as open_err:
        print(f"[ARGUS] Tavily skipped, breaker open: {open_err}")
        return {
            "web_snippets": [],
            "web_status": "unavailable",
            "trace_detail": f"breaker open: {open_err}"[:200],
            "trace_status": "fallback",
        }
    except Exception as err:
        print(f"[ARGUS] Tavily search failed, proceeding doc-only: {err!r}")
        return {
            "web_snippets": [],
            "web_status": "unavailable",
            "trace_detail": f"fail-open: {err!r}"[:200],
            "trace_status": "fallback",
        }

    # Same scan point as the upload-time chunk scanner (main.py) and the
    # synthesizer's Lock #2 chunk scan (synthesizer.py) — one shared pattern
    # list, applied here before a web snippet ever reaches the model.
    snippets = []
    quarantined = 0
    for r in results:
        content = (r.get("content") or "")[:MAX_SNIPPET_CHARS]
        url = r.get("url", "")
        title = r.get("title", "")

        if matches_any(content):
            quarantined += 1
            try:
                await supabase_request(
                    "POST", "security_events", state["access_token"],
                    json_body={
                        "user_id": state["user_id"],
                        "event_type": "web_content_as_instruction",
                        "source": f"web_scraped:{url}",
                        "detail": content[:300],
                        "user_agent": state.get("user_agent", "")[:300],
                    },
                )
            except Exception as log_err:
                print(f"[ARGUS] security_events write failed: {log_err}")
            print(f"[ARGUS] Quarantined web result from {url!r} - injection pattern detected.")
            continue

        snippets.append({
            "content": content,
            "url": url,
            "title": title,
            "trust_level": "web_scraped",
        })

    print(f"[ARGUS] web_scout query={state['query']!r} results={len(results)} "
          f"kept={len(snippets)} quarantined={quarantined}")
    return {
        "web_snippets": snippets,
        "web_status": "ok",
        "trace_detail": f"{len(snippets)} web snippets, {quarantined} quarantined",
    }
