import io
import re

import pdfplumber
from sentence_transformers import SentenceTransformer

# Loaded once at import time, not per-request. Reloading a transformer model
# on every upload would be painfully slow.
_model = SentenceTransformer("all-MiniLM-L6-v2")

CHUNK_SIZE = 800
CHUNK_OVERLAP = 100


def extract_text_from_pdf(file_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text_parts.append(page.extract_text() or "")
    return "\n\n".join(text_parts)


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


def embed_chunks(chunks: list[str]) -> list[list[float]]:
    embeddings = _model.encode(chunks, convert_to_numpy=True)
    return embeddings.tolist()


def process_pdf(file_bytes: bytes) -> list[dict]:
    text = extract_text_from_pdf(file_bytes)
    chunks = chunk_text(text)
    if not chunks:
        return []
    embeddings = embed_chunks(chunks)
    return [
        {"content": chunk, "embedding": embedding, "chunk_index": i}
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
    ]
