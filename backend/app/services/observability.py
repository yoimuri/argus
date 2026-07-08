"""Langfuse Cloud emitter — Sprint 3a.4.

Design note (deviation from the original PHASE3.md sketch, which called for a
'langfuse_breaker'): the Langfuse v2 SDK queues events into an in-process
background thread. trace()/span() calls never perform network I/O on the
request path, and delivery failures never propagate back to the caller. A
circuit breaker here would guard a call that cannot fail the way breakers
guard against — it would be dead code pretending to protect something. The
correct simple thing is what's below: lazy init in try/except, one
never-raises emit helper, clean disable when keys are absent. See ADR-016.

Iron rule still applies: observability must NEVER crash a research session.
"""
import os
from datetime import datetime, timedelta, timezone

_client = None
_disabled = False


def _get_client():
    """Lazy init on first emit. langfuse is imported HERE, not at module top,
    for the same 512MB-Render reason langgraph is lazy-imported in main.py —
    this module is only touched on the research path, which already pays that
    cost."""
    global _client, _disabled
    if _client is not None or _disabled:
        return _client

    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    if not public_key or not secret_key:
        _disabled = True
        print("[ARGUS] Langfuse disabled: LANGFUSE_PUBLIC_KEY/SECRET_KEY not set.")
        return None

    try:
        from langfuse import Langfuse
        _client = Langfuse(
            public_key=public_key,
            secret_key=secret_key,
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
        print("[ARGUS] Langfuse observability enabled.")
    except Exception as err:
        _disabled = True
        print(f"[ARGUS] Langfuse init failed, observability disabled: {err!r}")

    return _client


def record_step_span(session_id, user_id, agent_name, status, latency_ms, detail):
    """One span per agent step, grouped under one trace per session_id.
    Metadata only — never raw chunk/answer content (privacy rule, BLUEPRINT
    line 517, same stance as execution_steps.detail). Never raises: called
    directly from step_writer.traced() with no surrounding try/except at the
    call site, so this function is the guard."""
    if not session_id:
        return
    try:
        client = _get_client()
        if client is None:
            return

        end = datetime.now(timezone.utc)
        start = end - timedelta(milliseconds=latency_ms or 0)
        # client.trace(id=...) is an idempotent upsert in the v2 SDK, so calling
        # it once per step (rather than threading a trace handle through state)
        # is correct and stateless.
        trace = client.trace(id=str(session_id), name="research",
                              user_id=str(user_id) if user_id else None)
        level = {"ok": "DEFAULT", "fallback": "WARNING"}.get(status, "ERROR")
        trace.span(name=agent_name, start_time=start, end_time=end,
                   level=level, status_message=status,
                   metadata={"status": status, "latency_ms": latency_ms, "detail": detail})
    except Exception as err:
        print(f"[ARGUS] Langfuse emit failed (ignored): {err!r}")


def snapshot() -> dict:
    """For /health/circuit-breakers. Not a breaker: 'enabled' means keys are
    configured and init succeeded, not that Langfuse Cloud is reachable right
    now — the SDK delivers out-of-band, so reachability is invisible here."""
    return {"enabled": _client is not None, "disabled": _disabled}
