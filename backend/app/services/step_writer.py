import time
from app.services.supabase_client import supabase_request
from app.services.observability import record_step_span


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
    """Wraps a LangGraph node with Debug Diary timing/logging. A node may
    optionally return 'trace_detail' / 'trace_status' in its result dict to
    enrich its own step row; both are popped here so they never leak into
    ResearchState. A decorator instead of copy-pasting timing/logging into
    every node body.
    """
    def decorator(node_fn):
        async def wrapped(state):
            idx = state.get("step_index", 0)
            session_id = state.get("session_id")
            user_id = state.get("user_id")
            access_token = state.get("access_token")
            start = time.monotonic()

            try:
                result = await node_fn(state)
            except Exception:
                latency_ms = int((time.monotonic() - start) * 1000)
                await record_step(
                    session_id, user_id, access_token, idx, agent_name,
                    "error", latency_ms, "unhandled exception",
                )
                record_step_span(session_id, user_id, agent_name, "error", latency_ms, "unhandled exception")
                raise

            latency_ms = int((time.monotonic() - start) * 1000)
            detail = result.pop("trace_detail", None)
            status = result.pop("trace_status", "ok")

            await record_step(
                session_id, user_id, access_token, idx, agent_name,
                status, latency_ms, detail,
            )
            record_step_span(session_id, user_id, agent_name, status, latency_ms, detail)

            result["step_index"] = idx + 1
            return result

        return wrapped

    return decorator
