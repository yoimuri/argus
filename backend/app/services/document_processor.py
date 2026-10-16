import os
import re
import httpx
import fitz  # PyMuPDF

from app.services.circuit_breaker import embedding_breaker

# ── Embeddings provider: Cloudflare Workers AI (migrated 2026-10-15) ─────────
#
# WHY WE MOVED. Embeddings ran on HuggingFace's serverless Inference API until
# HF removed the free tier: free accounts now receive ZERO monthly credits, and
# every call returns `402 Payment Required — "You have no remaining credits."`
# That did not just stop uploads. embed_query() runs for EVERY sub-query of
# EVERY question (retriever.py), and embedding failure has no fallback by
# design, so the whole product was down. Confirmed in production on 2026-10-15:
# the same resume that indexed into 14 chunks on 2026-08-30 produced 0 chunks
# and a 500. ARGUS is a free-tier project by requirement, so the fix is a
# provider with a real free tier, not a subscription.
#
# WHY bge-small-en-v1.5 SPECIFICALLY. It outputs **384 dimensions**, the exact
# width of the existing `vector(384)` pgvector column — so this migration needs
# NO schema change. That is the whole reason this model was chosen over the
# larger bge variants (768/1024), which would have forced a column migration on
# top of everything else.
#
# WHAT THIS COSTS US. bge-small is a DIFFERENT model, so its vectors live in a
# different space from the old all-MiniLM-L6-v2 ones. Old and new vectors cannot
# be compared, which means every stored chunk must be re-embedded — see
# `scripts/reembed.py`. The chunk TEXT is already in the database, so that is an
# in-place batch job, not a re-upload of any PDF.
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
CF_API_TOKEN = os.getenv("CF_API_TOKEN", "")
CF_EMBED_MODEL = os.getenv("CF_EMBED_MODEL", "@cf/baai/bge-small-en-v1.5")
CF_EMBED_URL = (
    f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}"
    f"/ai/run/{CF_EMBED_MODEL}"
)

# Chunking (retuned Sprint 4.8, 2026-08-01 -- ADR-025).
#
# WHY 600, not the previous 800 (reasoning from the ORIGINAL all-MiniLM-L6-v2
# provider, kept because the conclusion still holds): that model had a hard
# input limit of 256 word-pieces and TRUNCATED silently beyond it. 800
# characters of ordinary prose is ~200 tokens (fits), but 800 characters of
# DENSE text -- table rows, a list of names, an ID column, a resume's skills
# block -- tokenizes far higher,
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
#
# 2026-10-15: the provider is now Cloudflare's bge-small-en-v1.5, whose input
# limit is 512 tokens rather than 256. 600 characters is therefore comfortably
# inside the window with roughly double the previous headroom, so the value is
# left alone — it was chosen for the tighter constraint and still satisfies the
# looser one. Changing it would invalidate every stored chunk for no gain.
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


def _chunks_for_page(page_text: str, current_header: str | None) -> list[str]:
    """Chunk one page's text, carrying the table header onto every chunk."""
    out = []
    for chunk in chunk_text(page_text):
        # Prepend the header unless this chunk already contains it (the chunk
        # that holds the header line itself needs no duplicate).
        if current_header and current_header not in chunk:
            out.append(f"[Columns: {current_header}] {chunk}")
        else:
            out.append(chunk)
    return out


def extract_chunks_from_pdf_file(file_path: str) -> list[str]:
    """Text-only extraction. Kept as the synchronous entry point for callers
    that must not perform network I/O; the upload path uses
    extract_chunks_with_ocr() below so scanned pages are not silently lost.

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
            all_chunks.extend(_chunks_for_page(page_text, current_header))
    finally:
        doc.close()

    return all_chunks


async def extract_chunks_with_ocr(file_path: str) -> tuple[list[str], dict]:
    """Sprint 4.6c: text extraction, with a vision-model pass over pages that
    have no extractable text (scanned / image-only pages).

    Returns (chunks, summary). The summary is what lets the API tell the user the
    truth about a partially-read scan:
        {"pages": int, "image_pages": int, "ocr_pages": int, "ocr_capped": bool}

    Page ORDER is preserved: OCR'd text is spliced back at its own page position
    rather than appended, so a mixed document (text pages plus a scanned insert)
    still reads in document order — which matters because the retriever's
    chunk_index ordering and the report generator's reading order both depend
    on it.
    """
    from app.services.ocr import MAX_OCR_PAGES, ocr_pages, page_needs_ocr

    doc = fitz.open(file_path)
    try:
        page_texts: list[str] = []
        image_pages: list[int] = []
        for index, page in enumerate(doc):
            text = page.get_text("text")
            page_texts.append(text)
            if page_needs_ocr(text):
                image_pages.append(index)

        summary = {
            "pages": len(page_texts),
            "image_pages": len(image_pages),
            "ocr_pages": 0,
            "ocr_capped": len(image_pages) > MAX_OCR_PAGES,
        }

        if image_pages:
            print(f"[ARGUS] {len(image_pages)} of {len(page_texts)} pages have no "
                  f"extractable text -> vision OCR")
            recovered, _attempted = await ocr_pages(doc, image_pages)
            summary["ocr_pages"] = len(recovered)
            for index, text in recovered.items():
                # Provenance marker: this text was machine-read from an image and
                # can contain recognition errors. The answering model is told to
                # weigh it accordingly, and a human reading a cited chunk can see
                # where it came from. It is prepended per page (not per chunk) so
                # it survives chunking without repeating on every fragment.
                page_texts[index] = f"[Scanned page — text recovered by OCR] {text}"
    finally:
        doc.close()

    all_chunks: list[str] = []
    current_header: str | None = None
    for page_text in page_texts:
        if not page_text.strip():
            continue
        header = _find_table_header(page_text)
        if header:
            current_header = header
        all_chunks.extend(_chunks_for_page(page_text, current_header))

    return all_chunks, summary


async def _cf_embed_once(texts: list[str]) -> list[list[float]]:
    """One Cloudflare Workers AI call. Always sends a LIST and always returns a
    list of vectors, so the batch and single-text paths share one shape and
    there is no "sometimes flat, sometimes nested" ambiguity to resolve later
    (the old HF path had exactly that, and it cost a BACKLOG bug).
    """
    if not CF_ACCOUNT_ID or not CF_API_TOKEN:
        raise ValueError(
            "CF_ACCOUNT_ID / CF_API_TOKEN are not set — embeddings cannot run. "
            "Set both on the backend host."
        )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            CF_EMBED_URL,
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
            json={"text": texts},
        )
        response.raise_for_status()
        payload = response.json()

    # Cloudflare's v4 envelope is {"success":bool,"errors":[...],"result":{...}}.
    # A failed call can still return HTTP 200 with success=false, which
    # raise_for_status() would not catch -- the same class of trap as HF's
    # cold-start 200-with-an-error-body. Checked explicitly.
    if not payload.get("success", False):
        raise ValueError(f"Cloudflare embedding error: {str(payload.get('errors'))[:300]}")

    vectors = (payload.get("result") or {}).get("data")
    if not isinstance(vectors, list) or not vectors:
        raise ValueError(f"Cloudflare embedding returned no data: {str(payload)[:300]}")

    # Validate EVERY vector, not just the first. A silently wrong-width vector
    # poisons retrieval in a way that looks like bad answers rather than an
    # error, which is the hardest kind of bug to trace back to its cause.
    for v in vectors:
        if not isinstance(v, list) or len(v) != EMBED_DIM or not all(isinstance(x, (int, float)) for x in v):
            raise ValueError(
                f"Cloudflare embedding returned a vector that is not {EMBED_DIM} floats "
                f"(got {len(v) if isinstance(v, list) else type(v).__name__}). "
                f"Check CF_EMBED_MODEL — the pgvector column is vector({EMBED_DIM})."
            )
    return vectors


async def _cf_embed_with_retry(texts: list[str]) -> list[list[float]]:
    """One retry before raising, for the same reason the HF path had one: a
    single transient network blip should not count as a provider outage.

    The retry lives INSIDE the unit passed to embedding_breaker.call(), so a
    real outage counts as ONE breaker failure per request rather than two --
    wrapping it the other way would trip the threshold twice as fast as
    intended.
    """
    try:
        return await _cf_embed_once(texts)
    except Exception as first_err:
        print(f"[ARGUS] embedding call failed, retrying once: {first_err!r}")
        return await _cf_embed_once(texts)


async def _call_embedding(texts: list[str]) -> list[list[float]]:
    return await embedding_breaker.call(_cf_embed_with_retry, texts)


async def embed_chunks(chunks: list[str]) -> list[list[float]]:
    vectors = await _call_embedding(chunks)
    # Guard the zip() in iter_embedded_chunk_batches: a short result would
    # silently drop the tail of a batch, losing chunks with no error at all.
    if len(vectors) != len(chunks):
        raise ValueError(
            f"embedding count mismatch: sent {len(chunks)} chunks, got {len(vectors)} vectors"
        )
    return vectors


async def embed_query(text: str) -> list[float]:
    """Single-text embedding for the retriever. Kept as its own function (same
    signature as before) so every caller upstream is unchanged by the provider
    switch. _cf_embed_once already validated the width, so there is no
    shape-guessing left to do here."""
    vectors = await _call_embedding([text])
    return vectors[0]


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