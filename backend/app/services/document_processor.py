import os
import re
import httpx
import fitz  # PyMuPDF

from app.services.circuit_breaker import hf_embedding_breaker

HF_TOKEN = os.environ["HF_TOKEN"]
HF_EMBEDDING_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
EMBED_BATCH_SIZE = 8
EMBED_DIM = 384  # all-MiniLM-L6-v2 output dimension; the pgvector column is vector(384)


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end < len(text):
            last_space = text.rfind(" ", start, end)
            if last_space > start:
                end = last_space
        chunks.append(text[start:end].strip())
        start = end - overlap if end - overlap > start else end
    return [c for c in chunks if c]


def extract_chunks_from_pdf_file(file_path: str) -> list[str]:
    """Parse PDF page-by-page using PyMuPDF to keep memory strictly on disk and C-level."""
    doc = fitz.open(file_path)
    full_text = ""
    
    for page in doc:
        # Extract text natively (uses C-level memory, extremely efficient)
        full_text += page.get_text("text") + "\n\n"
    doc.close()
    
    return chunk_text(full_text)


async def _hf_embedding_once(inputs):
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            HF_EMBEDDING_URL,
            headers={"Authorization": f"Bearer {HF_TOKEN}"},
            json={"inputs": inputs},
        )
        response.raise_for_status()
        result = response.json()

    # HF's cold start (~20s model load) returns a 200 with an {"error": "..."}
    # body, which raise_for_status() does not catch. Checked once here so both
    # callers below (embed_chunks and embed_query) get it for free -- until
    # Sprint 4.1, embed_chunks had NO validation at all, so this dict would
    # silently reach iter_embedded_chunk_batches's zip() and iterate the
    # dict's KEYS as if they were embedding vectors (BACKLOG 6).
    if isinstance(result, dict) and "error" in result:
        raise ValueError(f"HF embedding error response: {result['error']}")
    return result


async def _hf_embedding_with_retry(inputs):
    """One retry before raising -- HF cold starts are common enough that a
    bare first-attempt failure is often transient, not a real outage.

    Retries INSIDE this function, which is itself the single unit passed to
    hf_embedding_breaker.call() by _call_hf_embedding below -- so a real HF
    outage counts as ONE breaker failure per request, not two. Wrapping it
    the other way (breaker around each individual attempt) would double-count
    every real outage and reach the fail_threshold twice as fast as intended.
    """
    try:
        return await _hf_embedding_once(inputs)
    except Exception as first_err:
        print(f"[ARGUS] HF embedding call failed, retrying once: {first_err!r}")
        return await _hf_embedding_once(inputs)


async def _call_hf_embedding(inputs):
    return await hf_embedding_breaker.call(_hf_embedding_with_retry, inputs)


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    return await _call_hf_embedding(chunks)


async def embed_query(text: str) -> list[float]:
    result = await _call_hf_embedding(text)

    # HF's feature-extraction endpoint returns either a flat [384] vector or a
    # nested [[384]] (a single pooled row) for one input string. Resolve both to the
    # vector, but only accept a nested shape when it is exactly one row: a multi-row
    # 2-D array is token-level output (no pooling), which we must NOT silently collapse
    # to its first token. Leaving vector=None there routes it into the raise below.
    if isinstance(result, list) and result and isinstance(result[0], list):
        vector = result[0] if len(result) == 1 else None
    else:
        vector = result

    # Fail loud on anything that is not a real 384-float vector. Cold-start returns an
    # {"error": "...model loading..."} dict, and token-level output returns a multi-row
    # array; the old code passed either straight through as the "embedding", silently
    # poisoning retrieval (wrong/garbage vector) or getting rejected downstream as a
    # confusing empty answer. Raising here surfaces the real cause in the logs instead.
    # The retriever/synthesizer have no fallback for a bad embedding by design: a broken
    # embedding must not be allowed to look like "no results".
    if not isinstance(vector, list) or len(vector) != EMBED_DIM or not all(isinstance(x, (int, float)) for x in vector):
        preview = repr(result)[:300]
        raise ValueError(
            f"embed_query got an unexpected HF response (not a {EMBED_DIM}-float vector). "
            f"Raw payload preview: {preview}"
        )

    return vector


async def iter_embedded_chunk_batches(
    chunk_strings: list[str],
    batch_size: int = EMBED_BATCH_SIZE,
):
    """Yield batches of {content, embedding, chunk_index} to cap peak memory on free-tier hosts."""
    for start in range(0, len(chunk_strings), batch_size):
        batch = chunk_strings[start : start + batch_size]
        embeddings = await embed_chunks(batch)
        yield [
            {"content": text, "embedding": vector, "chunk_index": start + offset}
            for offset, (text, vector) in enumerate(zip(batch, embeddings))
        ]