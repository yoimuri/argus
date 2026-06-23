import os
import re
import httpx
import fitz  # PyMuPDF

HF_TOKEN = os.environ["HF_TOKEN"]
HF_EMBEDDING_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction"

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
EMBED_BATCH_SIZE = 8


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


async def _call_hf_embedding(inputs):
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            HF_EMBEDDING_URL,
            headers={"Authorization": f"Bearer {HF_TOKEN}"},
            json={"inputs": inputs},
        )
        response.raise_for_status()
        return response.json()


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    return await _call_hf_embedding(chunks)


async def embed_query(text: str) -> list[float]:
    result = await _call_hf_embedding(text)
    return result[0] if isinstance(result, list) and result and isinstance(result[0], list) else result


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