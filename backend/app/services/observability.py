"""Langfuse Cloud tracing — Sprint 3a.4, upgraded to SDK v4.

Design notes (see docs/ADR-016.md for the full reasoning):

- **v4, not v2.** A prior version of this file pinned the old v2 SDK to avoid
  v3+'s OpenTelemetry dependency tree. A real measurement (installing both in
  clean venvs, comparing import RSS) showed the marginal cost of v4 over v2 is
  ~4MB — both already pull in pydantic/httpx as shared FastAPI dependencies —
  negligible next to langgraph's own ~100MB already accepted on this same
  512MB Render instance. Per Langfuse's own skill guidance ("always use the
  latest version unless there's a good reason not to"), that's not a good
  enough reason anymore.

- **Manual spans, not the LangChain/LangGraph CallbackHandler integration.**
  The framework integration is Langfuse's own general recommendation, but it
  auto-captures each node's FULL LangGraph state as span input/output — for
  ARGUS that means every retrieved chunk's full content and the full answer,
  sent to a third-party cloud service. That directly contradicts this
  project's own privacy stance (ADR-013: Groq and HuggingFace are the only
  disclosed sub-processors that see full document content) and the Debug
  Diary's existing rule that `execution_steps.detail` is a truncated summary,
  never full content (BLUEPRINT.md line 517). Manual spans send exactly what
  step_writer.py already decided to send — the same short `trace_detail`
  string written to Postgres — so Langfuse never sees more than the diary
  does. It's also the lighter dependency: the CallbackHandler requires the
  full `langchain` package (not just `langchain-core`, which LangGraph already
  needs), measured at ~15MB heavier than this manual route.

- **GroqInstrumentor for model/token capture.** The one thing manual spans
  don't give you for free is per-call model name and token usage (Langfuse's
  own skill lists both as baseline requirements, not nice-to-haves). Rather
  than hand-roll that, `GroqInstrumentor().instrument()` (from
  `openinference-instrumentation-groq`) patches the `groq` SDK process-wide
  once, so every existing `AsyncGroq` call in orchestrator.py/synthesizer.py/
  critic.py gets automatic model+token capture with zero changes to those
  files. It must run AFTER the Langfuse client is constructed (that's what
  registers Langfuse as the active OpenTelemetry tracer provider — the
  official Groq cookbook instruments in this exact order) and its spans nest
  correctly under whichever `traced_span()` block is active because
  `start_as_current_observation` sets the ambient OTel context for the
  duration of its `with` block, and the Groq call happens inside that block.

- **Masking as defense in depth.** `mask_otel_spans` truncates every string
  span attribute over 300 chars (matching `execution_steps.detail`'s own
  truncation convention) before export. Our own spans are already short by
  construction, but this catches anything unexpected without relying on that
  alone.

- **Still no breaker** (unchanged from the original decision). OpenTelemetry's
  BatchSpanProcessor exports on a background thread; a failed or dropped
  export never blocks or raises on the calling thread. This is standard
  OTel behavior, not a Langfuse-specific claim, so it holds even more solidly
  under v4 than it did under v2's own custom batching.

Iron rule still applies: nothing in this file may ever crash a research
session. Every public function here either returns a safe no-op value or logs
and swallows its own failure.
"""
import os
from contextlib import contextmanager, ExitStack

_client = None
_disabled = False
_groq_instrumented = False

MAX_ATTR_CHARS = 300


class _NoOpSpan:
    """Yielded when Langfuse isn't configured or a span couldn't be created,
    so callers never have to branch on `if span is not None`."""

    def update(self, **kwargs):
        pass


def _mask_otel_spans(*, params):
    from langfuse.types import MaskOtelSpansResult, OtelSpanPatch

    patches = {}
    for identifier, span in params.spans.items():
        replacements = {}
        for key, value in span.attributes.items():
            if isinstance(value, str) and len(value) > MAX_ATTR_CHARS:
                replacements[key] = value[:MAX_ATTR_CHARS] + "...[truncated]"
        if replacements:
            patches[identifier] = OtelSpanPatch(set_attributes=replacements)
    return MaskOtelSpansResult(span_patches=patches)


def _instrument_groq():
    global _groq_instrumented
    if _groq_instrumented:
        return
    try:
        from openinference.instrumentation.groq import GroqInstrumentor
        GroqInstrumentor().instrument()
        _groq_instrumented = True
        print("[ARGUS] Groq calls auto-instrumented for Langfuse (model + token capture).")
    except Exception as err:
        print(f"[ARGUS] Groq auto-instrumentation failed, tracing continues without it: {err!r}")


def _get_client():
    """Lazy init on first span. langfuse is imported HERE, not at module top,
    for the same 512MB-Render reason langgraph is lazy-imported in main.py —
    this module is only touched on the research path, which already pays
    that cost."""
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
            base_url=os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com"),
            mask_otel_spans=_mask_otel_spans,
        )
        print("[ARGUS] Langfuse observability enabled (SDK v4).")
        _instrument_groq()
    except Exception as err:
        _disabled = True
        print(f"[ARGUS] Langfuse init failed, observability disabled: {err!r}")

    return _client


@contextmanager
def traced_span(agent_name: str, session_id, user_id):
    """Wraps one LangGraph node's execution in a Langfuse span, keyed to the
    session's own id (dashes stripped -> exactly the 32 hex chars OpenTelemetry
    trace ids require, so no second id to generate or track). Any Groq call
    made inside the `with` block nests under this span automatically via
    GroqInstrumentor.

    Never raises. Setup failures (missing keys, a bad session_id, an SDK
    error) fall back to a no-op span so the wrapped node runs exactly as if
    tracing didn't exist. Once setup succeeds, exceptions raised by the
    wrapped node propagate normally — this context manager only guards its
    OWN setup/teardown, never the caller's control flow.
    """
    if not session_id:
        yield _NoOpSpan()
        return

    client = _get_client()
    if client is None:
        yield _NoOpSpan()
        return

    with ExitStack() as stack:
        try:
            trace_id = str(session_id).replace("-", "")
            span = stack.enter_context(client.start_as_current_observation(
                as_type="span", name=agent_name, trace_context={"trace_id": trace_id},
            ))
            from langfuse import propagate_attributes
            stack.enter_context(propagate_attributes(
                user_id=str(user_id) if user_id else None,
                session_id=str(session_id),
                tags=["research"],
                trace_name="research",
            ))
        except Exception as err:
            print(f"[ARGUS] Langfuse span setup failed (ignored): {err!r}")
            yield _NoOpSpan()
            return

        yield span


def mark_span(span, status: str, detail):
    """Best-effort span.update — isolated so a bad `detail` value, or a span
    already invalid for any reason, can't affect the caller."""
    try:
        level = {"ok": "DEFAULT", "fallback": "WARNING"}.get(status, "ERROR")
        span.update(output=detail, level=level, status_message=status)
    except Exception as err:
        print(f"[ARGUS] Langfuse span update failed (ignored): {err!r}")


def snapshot() -> dict:
    """For /health/circuit-breakers. Not a breaker: 'enabled' means keys are
    configured and init succeeded, not that Langfuse Cloud is reachable right
    now — the SDK delivers out-of-band, so reachability is invisible here."""
    return {"enabled": _client is not None, "disabled": _disabled}
