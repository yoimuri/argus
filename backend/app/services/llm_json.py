import json

# Effort floor for the D18 retry: one step down the ladder, capped at "low"
# (gpt-oss-20b has no effort below that). A "low"-effort call that still
# truncates gets retried at "low" again -- not a no-op, since reasoning
# length varies run-to-run at fixed effort; it's a second roll, not a
# guaranteed fix.
_EFFORT_LADDER = {"high": "medium", "medium": "low", "low": "low"}


class ReasoningTruncated(Exception):
    """Raised when a Groq reasoning-model call comes back with
    finish_reason == "length" on both the initial attempt and the
    lower-effort retry.

    gpt-oss-20b spends hidden reasoning tokens before any visible content,
    and max_tokens caps the two combined. A long reasoning pass can starve
    the visible output entirely, leaving empty or cut-off content with no
    exception raised by the SDK. This has independently bitten three agents
    in this project (ADR-014, Sprint 3a.1, Sprint 3b) because each one
    hand-tuned its own budget/effort without ever reading finish_reason --
    call_reasoning_json() below is the one place that now checks it, so the
    bug can't quietly reappear in a fourth agent.
    """


async def call_reasoning_json(client, breaker, *, model: str, messages: list[dict],
                               max_tokens: int, reasoning_effort: str) -> str:
    """Run a Groq reasoning-model completion through `breaker`, with one
    automatic retry at a lower reasoning_effort if the response truncated.

    Returns the raw message content string (callers that need JSON still
    call extract_json() on the result themselves; this helper doesn't parse,
    since not every caller wants JSON -- the synthesizer's output is plain
    text). Raises ReasoningTruncated if content is still truncated after the
    retry; raises whatever the client raises on a real network/API failure.
    Callers keep their own fail-open except block around this call, same as
    before.

    Both attempts happen inside a single breaker.call() so a real outage
    (an exception on either attempt) counts as ONE breaker failure, not two
    -- same principle as the HF embedding retry (see circuit_breaker.py).
    Truncation is a content problem, not an availability problem: it
    deliberately does NOT open the breaker, matching the pre-helper behavior
    where finish_reason was never even read.
    """
    retry_effort = _EFFORT_LADDER.get(reasoning_effort, reasoning_effort)

    async def _attempt(effort: str):
        completion = await client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            extra_body={"reasoning_effort": effort},
        )
        choice = completion.choices[0]
        return choice.message.content, choice.finish_reason

    async def _call_with_retry():
        content, finish_reason = await _attempt(reasoning_effort)
        if finish_reason != "length":
            return content, False
        print(f"[ARGUS] reasoning call truncated (finish_reason=length) at "
              f"effort={reasoning_effort!r}, retrying once at effort={retry_effort!r}")
        content, finish_reason = await _attempt(retry_effort)
        return content, finish_reason == "length"

    content, still_truncated = await breaker.call(_call_with_retry)
    if still_truncated:
        raise ReasoningTruncated(
            f"reasoning call truncated at both {reasoning_effort!r} and "
            f"{retry_effort!r} effort (max_tokens={max_tokens})"
        )
    return content


def extract_json(raw: str) -> dict:
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
