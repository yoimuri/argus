import json


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
