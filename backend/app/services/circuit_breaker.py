"""Sprint 2.4 — circuit breaker for external API calls.

One shared breaker per external service. Groq, HF (ADR-012), and Tavily
(Sprint 3b, ADR-017) each have one; ip-api gets its in Phase 4. Langfuse
deliberately does NOT get one (Sprint 3a.4) — its SDK delivers on a background
thread, so there's no request-path failure to guard against; see ADR-016. All
state mutation happens under an
asyncio.Lock — the V3 blueprint audit flagged unguarded list mutation under
async concurrency as a real race. time.monotonic() everywhere: wall-clock
jumps (NTP sync, DST) must never open or close a breaker.

States: closed (normal) -> open (threshold failures inside the window; calls
are rejected instantly without touching the network) -> half_open (recovery
window elapsed; lets a probe through) -> closed on success / open on failure.
While half-open, more than one concurrent request can slip through as a probe;
acceptable for this scale, noted rather than engineered away.
"""
import asyncio
import time


class CircuitBreakerOpen(Exception):
    """Raised instead of making the network call while the breaker is open."""

    def __init__(self, name: str, retry_in_s: float):
        self.name = name
        self.retry_in_s = retry_in_s
        super().__init__(f"{name} breaker open, retry in ~{retry_in_s:.0f}s")


class CircuitBreaker:
    def __init__(self, name: str, fail_threshold: int = 5,
                 failure_window_s: float = 120, recover_timeout_s: float = 60):
        self.name = name
        self.fail_threshold = fail_threshold
        self.failure_window_s = failure_window_s
        self.recover_timeout_s = recover_timeout_s
        self._failures: list[float] = []
        self._state = "closed"
        self._opened_at = 0.0
        self._lock = asyncio.Lock()

    async def call(self, fn, *args, **kwargs):
        """Run fn(*args, **kwargs) through the breaker.

        Raises CircuitBreakerOpen without touching the network if open and the
        recovery window hasn't elapsed. The caller decides the fallback — this
        class never invents a response on its own.
        """
        async with self._lock:
            if self._state == "open":
                elapsed = time.monotonic() - self._opened_at
                if elapsed < self.recover_timeout_s:
                    raise CircuitBreakerOpen(self.name, self.recover_timeout_s - elapsed)
                self._state = "half_open"

        try:
            result = await fn(*args, **kwargs)
        except Exception:
            async with self._lock:
                now = time.monotonic()
                self._failures = [t for t in self._failures if now - t < self.failure_window_s]
                self._failures.append(now)
                if self._state == "half_open" or len(self._failures) >= self.fail_threshold:
                    self._state = "open"
                    self._opened_at = now
                    print(f"[ARGUS] CircuitBreaker '{self.name}' OPEN "
                          f"({len(self._failures)} failures in window)")
            raise

        async with self._lock:
            if self._state != "closed":
                print(f"[ARGUS] CircuitBreaker '{self.name}' recovered, back to CLOSED")
            self._failures.clear()
            self._state = "closed"
        return result

    async def snapshot(self) -> dict:
        """State for /status/breakers and the Phase 4 SOC view."""
        async with self._lock:
            return {
                "state": self._state,
                "recent_failures": len(self._failures),
                "fail_threshold": self.fail_threshold,
                "seconds_since_opened": (
                    round(time.monotonic() - self._opened_at, 1)
                    if self._state == "open" else None
                ),
            }


# The synthesizer's answer-generation call shares this instance. The query
# guard's classifier used to share it too (ADR-007/ADR-011), but ADR-012
# replaced that classifier with a purpose-built HF injection model, which gets
# its own breaker below since it's a different upstream with its own failure mode.
# Thresholds from BLUEPRINT.md's breaker table (Groq row).
groq_breaker = CircuitBreaker("groq", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# ADR-012: guards the prompt-injection classifier call in injection_guard.py.
# Separate from groq_breaker, and STILL separate after the 2026-10-15 migration
# moved this classifier onto Groq: the point was never "a different vendor", it
# is that a guard outage and an inference outage are different failure modes.
# injection_guard.py treats this breaker opening as "skip the AI layer, let
# regex carry", which must not be triggered by the Q&A pipeline struggling.
# Renamed from hf_breaker/"hf_prompt_guard" when the provider changed — a name
# that encodes a vendor goes stale the moment the vendor does.
injection_guard_breaker = CircuitBreaker("injection_guard", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# ADR-017 (Sprint 3b): guards the Tavily web-search call in web_scout.py. Same
# thresholds as the other two — no scale evidence yet to justify a different
# tuning. Tavily down means research falls back to doc-only with a banner, it
# never blocks or 500s (see web_scout.py's fail-open path).
tavily_breaker = CircuitBreaker("tavily", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# Sprint 4.1 (D7, BACKLOG 6): guards the embedding call in
# document_processor.py (Cloudflare Workers AI since 2026-10-15). Deliberately
# its OWN instance, separate from injection_guard_breaker above -- that breaker
# opening means "skip the AI classifier layer, fall back to regex-only", a safe
# degradation for the security guard. Sharing one circuit would let an embedding
# outage silently downgrade the injection guard as a side effect; two unrelated
# failure modes must not share one breaker.
# Renamed from hf_embedding_breaker/"hf_embedding" with the provider move.
embedding_breaker = CircuitBreaker("embedding", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# Sprint 4.5 (ADR-021): guards the Gemini call behind the public project-Q&A
# chatbot. Its own instance -- a Gemini outage must degrade the chatbot to a
# "resting" message without touching the authenticated research path's breakers
# (Groq/HF/Tavily) or vice versa. Same thresholds; no scale evidence to tune
# differently yet.
gemini_breaker = CircuitBreaker("gemini_chat", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# Sprint 4.6a fix batch #2 (2026-07-13, ADR-022 revision): guards the report
# generator's Groq calls, SEPARATE from groq_breaker on this file's own rule --
# two unrelated failure modes must not share one circuit. Live-proven cost of
# sharing: a report run that exhausted the free-tier token meter (429s) opened
# the shared breaker and degraded interactive Q&A for the next minute
# (orchestrator/synthesizer/critic all fail-open) even though Groq itself was
# perfectly healthy. Background batch work and interactive queries now fail
# independently.
groq_report_breaker = CircuitBreaker("groq_report", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)

# Sprint 4.6c (2026-08-31): guards the vision/OCR calls that read image-only PDF
# pages. Separate for the same reason groq_report_breaker is separate -- OCR runs
# during upload, on a different Groq model with its own rate-limit bucket, and a
# scanned-PDF upload burning through vision quota must not open the circuit that
# interactive Q&A depends on. Also fails independently of the report breaker: an
# OCR outage should never make report generation look broken.
groq_vision_breaker = CircuitBreaker("groq_vision", fail_threshold=4, failure_window_s=120, recover_timeout_s=90)
