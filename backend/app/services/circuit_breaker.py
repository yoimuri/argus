"""Sprint 2.4 — circuit breaker for external API calls.

One shared breaker per external service (Groq only for now, per Phase 2 scope;
HF/Tavily/ip-api get theirs in Phase 4). All state mutation happens under an
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
        """State for /health/circuit-breakers and, later, the Phase 4 SOC view."""
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

# ADR-012: guards the HF prompt-injection classifier call in injection_guard.py.
# Separate from groq_breaker because it's a different upstream (HuggingFace, not
# Groq) with its own independent failure mode — Groq being down shouldn't open
# this one and vice versa.
hf_breaker = CircuitBreaker("hf_prompt_guard", fail_threshold=5, failure_window_s=120, recover_timeout_s=60)
