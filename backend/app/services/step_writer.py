import time
from app.services.supabase_client import supabase_request
from app.services.observability import traced_span, mark_span


class ResearchCancelled(Exception):
    """Raised between agent nodes when the session row says 'cancelled'.

    Cancel rework (2026-07-10): the frontend's Cancel button calls
    POST /research/{id}/cancel, which flips the session's status in the DB.
    The pipeline can't learn about a client disconnect any other way on
    Render (its proxy buffers the request cycle and never propagates the
    abort -- two disconnect-based designs failed live before this), so each
    traced node checks the flag before running and raises this to stop the
    graph. Caught in main.py's /research handler, never turned into a 500."""
    pass


async def _session_cancelled(session_id, access_token) -> bool:
    """True only when the session row explicitly reads 'cancelled'. Any
    failure of the check itself (transient Supabase blip) returns False --
    a health check must never kill a healthy research run."""
    try:
        rows = await supabase_request(
            "GET", f"research_sessions?id=eq.{session_id}&select=status", access_token,
        )
        return bool(rows) and rows[0].get("status") == "cancelled"
    except Exception as check_err:
        print(f"[ARGUS] cancel-check failed for session {session_id} (assuming running): {check_err}")
        return False


async def record_step(session_id, user_id, access_token, step_index, agent_name, status, latency_ms, detail):
    """Writes one execution_steps row. Never raises — the diary is a passive
    observer; if this write fails (bad table, RLS glitch, Supabase down), the
    research session must still complete unaffected (blueprint hard requirement)."""
    try:
        await supabase_request(
            "POST",
            "execution_steps",
            access_token,
            json_body={
                "session_id": session_id,
                "user_id": user_id,
                "step_index": step_index,
                "agent_name": agent_name,
                "status": status,
                "latency_ms": latency_ms,
                "detail": detail,
            },
        )
    except Exception as err:
        print(f"[ARGUS] execution_steps write failed for {agent_name} (session={session_id}): {err!r}")


def traced(agent_name: str):
    """Wraps a LangGraph node with Debug Diary timing/logging AND a Langfuse
    span (observability.traced_span). The node runs INSIDE the Langfuse span
    (not after it) so any Groq call the node makes nests under that span
    automatically via GroqInstrumentor — see observability.py's module
    docstring for why. A node may optionally return 'trace_detail' /
    'trace_status' in its result dict to enrich its own step row; both are
    popped here so they never leak into ResearchState. A decorator instead of
    copy-pasting timing/logging into every node body.
    """
    def decorator(node_fn):
        async def wrapped(state):
            idx = state.get("step_index", 0)
            session_id = state.get("session_id")
            user_id = state.get("user_id")
            access_token = state.get("access_token")

            # Cancel checkpoint (2026-07-10): one cheap status read before each
            # agent runs. Costs ~6-9 small selects per research call; buys the
            # ability to actually STOP mid-pipeline when the user cancels,
            # which no disconnect-based mechanism can do behind Render's proxy.
            # session_id None = diary disabled = nothing to check against.
            if session_id and await _session_cancelled(session_id, access_token):
                print(f"[ARGUS] session {session_id} cancelled by user -- stopping before {agent_name}.")
                raise ResearchCancelled()

            start = time.monotonic()

            try:
                with traced_span(agent_name, session_id, user_id) as span:
                    result = await node_fn(state)
                    detail = result.pop("trace_detail", None)
                    status = result.pop("trace_status", "ok")
                    mark_span(span, status, detail)
            except Exception:
                latency_ms = int((time.monotonic() - start) * 1000)
                await record_step(
                    session_id, user_id, access_token, idx, agent_name,
                    "error", latency_ms, "unhandled exception",
                )
                raise

            latency_ms = int((time.monotonic() - start) * 1000)
            await record_step(
                session_id, user_id, access_token, idx, agent_name,
                status, latency_ms, detail,
            )

            result["step_index"] = idx + 1
            return result

        return wrapped

    return decorator
