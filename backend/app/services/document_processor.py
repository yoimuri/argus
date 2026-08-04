import os
import re
import httpx
import fitz  # PyMuPDF

from app.services.circuit_breaker import hf_embedding_breaker

HF_TOKEN = os.environ["HF_TOKEN"]
HF_EMBEDDING_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction"

# Chunking (retuned Sprint 4.8, 2026-08-01 -- ADR-025).
#
# WHY 600, not the previous 800: all-MiniLM-L6-v2 has a hard input limit of 256
# word-pieces and TRUNCATES silently beyond it. 800 characters of ordinary prose
# is ~200 tokens (fits), but 800 characters of DENSE text -- table rows, a list
# of names, an ID column, a resume's skills block -- tokenizes far higher,
# because names/numbers/codes fragment into several word-pieces each. Those
# chunks were being embedded from their first ~256 tokens only, so the tail of
# every dense chunk was invisible to semantic search while still occupying a
# chunk slot. That is a direct cause of the reported "good on the report,
# bad on the student list" behaviour. 600 chars keeps dense content inside the
# window with margin, at the cost of slightly more chunks per document.
#
# WHY overlap 200, not 100: a fact that straddles a chunk boundary (a table row
# split mid-record, "POYAOAN, Clint Branwel Dayap ** CICS - BSCS LBA Row 2
# White" cut after the name) is retrievable only if some chunk contains it
# whole. Live-confirmed on the 2,000-row seating list: records genuinely sit at
# boundaries (chunk 232 ended mid-record at "...1503"), and a record split
# across two chunks can lose the association between a name and its seat
# number even when both chunks are retrieved. 200/600 = 33% overlap, above the
# usual 25% recommendation because record-like rows here are ~55 chars and a
# generous overlap guarantees several whole rows of context on both sides of
# every cut.
#
# NOTE: chunk size applies at INGEST time. Documents already uploaded keep their
# old 800-char chunks until they are re-uploaded.
CHUNK_SIZE = 600
CHUNK_OVERLAP = 200
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


# Table-header detection (2026-08-01, live-found on a 2,000-row seating list).
#
# THE PROBLEM: PDF text extraction flattens a table into one continuous run of
# words. A seating list becomes
#     "... 1499 POLIARCO, Lyrine Manahan CICS - BSCS LBA Row 2 White
#          1500 POYAOAN, Clint Branwel Dayap ** CICS - BSCS LBA Row 2 White ..."
# with no separators. The leading number IS the seat number, but nothing in the
# text says so, and the number sits between two names — so a model reading only
# this excerpt cannot tell whether 1500 belongs to the name before it or after
# it. Live result: ARGUS found the right row and still answered "no seat number
# is shown", which is the CORRECT refusal given ambiguous input.
#
# The header line ("SEAT NO. NAME COLLEGE ROW NO. COLUMN NO. SEAT COLOR")
# exists — but only at each PDF page break, so a chunk from the middle of a
# page carries no column context at all.
#
# THE FIX: detect the header on each page and prepend it to every chunk made
# from that page. Costs ~60 chars per chunk and turns an ambiguous number
# sequence into a labelled record the model can read confidently.
_HEADER_HINTS = (
    "seat no", "name", "college", "row no", "column no", "seat color",
    "student", "id no", "employee", "department", "date", "amount", "total",
    "no.", "code", "description", "qty", "quantity", "price", "status",
)


def _find_table_header(page_text: str) -> str | None:
    """Return this page's table header, if one is present.

    2026-08-04 REWRITE — the line-based version never fired on real PDFs.
    It required the header to sit on its OWN short line (<=160 chars). That is
    how a header looks when you type an example by hand; it is NOT how PyMuPDF
    extracts a real table. Live evidence from this project's own database: the
    seating list's first chunk was ONE continuous 400+ char run --
        "... Final list of graduates 1 SEAT NO. NAME COLLEGE ROW NO. COLUMN NO.
         SEAT COLOR 1 ALCANZO, Imelda Cautivar SGS - ..."
    -- so the header is embedded mid-line and every candidate line blew straight
    past the length limit. Result: 0 headers detected on a document that plainly
    has one (verified: chunks_with_header = 0 after a re-upload on the deployed
    fix). The detector was validated against a hand-written sample instead of
    real extractor output, which is exactly the wrong way round.

    This version searches the page TEXT for a run of consecutive column-ish
    words, wherever it sits, which works for both layouts.
    """
    # Look only near the start of the page: headers precede their table.
    window = " ".join(page_text.split())[:1200]
    if not window:
        return None
    low = window.lower()

    # Find the earliest and latest positions of distinct header keywords within
    # a short span. A real header packs >=3 of them close together; prose that
    # happens to contain "name" and "date" pages apart will not.
    positions: list[tuple[int, int, str]] = []
    for hint in _HEADER_HINTS:
        idx = low.find(hint)
        if idx != -1:
            positions.append((idx, idx + len(hint), hint))
    if len(positions) < 3:
        return None

    positions.sort()
    # Slide a window over the sorted hits and keep the tightest cluster of >=3.
    best: tuple[int, int, int] | None = None  # (span, start, end)
    for i in range(len(positions) - 2):
        for j in range(i + 2, len(positions)):
            start = positions[i][0]
            end = positions[j][1]
            span = end - start
            # A header is compact: >=3 keywords inside ~120 characters.
            if span <= 120 and (best is None or (j - i) > (best[2] - best[1])):
                best = (span, i, j)
    if best is None:
        return None

    _, i, j = best
    start = positions[i][0]
    end = positions[j][1]
    header = window[start:end].strip()

    # Trim any document-title text that precedes the real column run. The
    # cluster can legitimately start on a title word ("Seating number Final list
    # of graduates 1 SEAT NO. NAME ..."); the useful part for the model is the
    # column names, so cut to the strongest column keyword if one appears later.
    for anchor in ("seat no", "id no", "row no", "student", "employee", "no."):
        pos = header.lower().find(anchor)
        if pos > 0:
            header = header[pos:].strip()
            break

    # Guard against a degenerate match (too short to be meaningful).
    return header if len(header) >= 10 else None


def extract_chunks_from_pdf_file(file_path: str) -> list[str]:
    """Parse PDF page-by-page using PyMuPDF to keep memory strictly on disk and
    C-level.

    Chunks are built PER PAGE (rather than over one concatenated string) so each
    page's table header can be carried onto its own chunks — see
    _find_table_header. A page with no detectable header behaves exactly as
    before. The last header seen carries forward to later pages, because tables
    that span pages often print the header only once.
    """
    doc = fitz.open(file_path)
    all_chunks: list[str] = []
    current_header: str | None = None

    try:
        for page in doc:
            # Extract text natively (uses C-level memory, extremely efficient)
            page_text = page.get_text("text")
            if not page_text.strip():
                continue

            header = _find_table_header(page_text)
            if header:
                current_header = header

            for chunk in chunk_text(page_text):
                # Prepend the header unless this chunk already contains it (the
                # chunk that holds the header line itself needs no duplicate).
                if current_header and current_header not in chunk:
                    all_chunks.append(f"[Columns: {current_header}] {chunk}")
                else:
                    all_chunks.append(chunk)
    finally:
        doc.close()

    return all_chunks


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