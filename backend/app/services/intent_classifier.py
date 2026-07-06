import os
import httpx

HF_TOKEN = os.environ["HF_TOKEN"]
HF_INJECTION_MODEL_URL = "https://router.huggingface.co/hf-inference/models/protectai/deberta-v3-base-prompt-injection-v2"

# Threshold on the model's INJECTION-label probability, not a keyword match —
# this is the actual fix for "rewording bypasses the guard": a purpose-built
# classifier judges intent, so a paraphrase that shares zero keywords with
# injection_patterns.py's regex list still scores >0.99 INJECTION. Verified
# live against two such paraphrases before this file was wired in (see ADR-012).
INJECTION_THRESHOLD = float(os.getenv("INJECTION_SCORE_THRESHOLD", "0.5"))


async def injection_score(text: str) -> float:
    """Returns the model's INJECTION-label probability (0.0-1.0) for the given text.

    Same httpx call pattern as document_processor._call_hf_embedding: one client
    per call, bearer token, raise_for_status so a non-2xx becomes an exception
    the circuit breaker records as a failure.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            HF_INJECTION_MODEL_URL,
            headers={"Authorization": f"Bearer {HF_TOKEN}"},
            json={"inputs": text},
        )
        response.raise_for_status()
        result = response.json()

    # HF text-classification returns either a flat list of label/score dicts,
    # or (as observed live) a list nested one level deeper: [[{...}, {...}]].
    # Unwrap once if needed, then pull out the INJECTION label's score.
    if isinstance(result, list) and result and isinstance(result[0], list):
        result = result[0]

    for entry in result:
        if isinstance(entry, dict) and entry.get("label", "").upper() == "INJECTION":
            return float(entry["score"])

    return 0.0
