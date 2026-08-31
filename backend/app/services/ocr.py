"""Sprint 4.6c — reading image-only (scanned) PDF pages via a vision model.

WHY THIS EXISTS. PyMuPDF's get_text() returns nothing for a page that is a
picture of text, so a scanned PDF produced zero chunks and was (since the
2026-08-01 fix) honestly rejected with "no readable text could be extracted".
That was the correct behaviour for a system that could not read images. This
module removes the limitation: pages with no extractable text are rendered to an
image and passed to a vision model, and the returned text rejoins the normal
chunk pipeline.

THE CONSTRAINTS THAT SHAPE EVERY NUMBER HERE (verified against Groq's docs on
2026-08-31, not recalled):

  * Vision models: qwen/qwen3.6-27b (up to 5 images per request) and
    qwen/qwen3.8-27b (up to 3). We send ONE page per request -- batching pages
    into one call would make a single failure lose several pages and makes the
    per-page provenance marker impossible.
  * EVERY IMAGE COSTS 2048 INPUT TOKENS, flat, regardless of page content.
  * Free tier, per model: 8,000 tokens/minute, 30 requests/minute, 200,000
    tokens/day.

So the real budget is ~2-3 pages per minute, not "as fast as the loop runs".
Exceeding the per-minute meter does not fail loudly -- the SDK backs off and the
upload appears to hang, which is the failure mode this project has already been
burned by twice. Hence the pacer below and a hard page cap.

QUOTA ISOLATION. Groq meters each model separately, so vision runs on a bucket
that the Q&A pipeline (gpt-oss-20b) and report generation (gpt-oss-120b) never
touch. A user uploading a 40-page scan cannot slow down anyone's questions.
Backed by its own circuit breaker for the same reason.

TRUST. Text recovered from an image is exactly as untrusted as text extracted
normally -- it came from a user-supplied document. It is returned as plain text
and rejoins the same ingest path, so the existing injection scan and
quarantine at upload apply to it unchanged. Each OCR'd chunk is prefixed with a
provenance marker so the answering model knows the text was machine-read and may
contain recognition errors.
"""
import asyncio
import base64
import os
import time

from groq import AsyncGroq

from app.services.circuit_breaker import groq_vision_breaker

# Verified available on 2026-08-31 (console.groq.com/docs/vision). Env-overridable
# so a model deprecation is a config change on Render, not a redeploy.
VISION_MODEL = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.6-27b")

# Hard cap on pages OCR'd per document. At ~2-3 pages/minute this bounds a
# scanned upload to roughly two minutes of vision work. Raising it does not just
# cost money -- it makes the upload request longer, and long synchronous requests
# are the one thing this platform has repeatedly proven unreliable (see the
# Sprint 4.3 cancel rework). A document longer than the cap is processed up to
# the cap and SAYS SO; partial-but-honest beats hanging.
MAX_OCR_PAGES = int(os.getenv("MAX_OCR_PAGES", "8"))

# A page whose extracted text is shorter than this is treated as image-only.
# Not zero: a scanned page often yields a stray artefact -- a page number, a
# header run in by the scanner -- while carrying no real content.
TEXT_PAGE_MIN_CHARS = 80

# Render DPI. 150 keeps body text legible for the model while holding a rendered
# A4 page around 1-2MB of PNG (Groq's request ceiling is 20MB, so there is ample
# headroom); going higher costs memory on a 512MB dyno for no accuracy gain,
# since the image is charged as a flat 2048 tokens either way.
RENDER_DPI = 150

# Output budget per page. Enough for a dense page of text; capped so one bad
# page cannot eat the minute's whole token allowance.
OCR_MAX_TOKENS = 1_400

# Client-side pacer. Same approach as report_generator's, kept local so the two
# do not share a ledger -- they meter different models with independent limits.
TPM_BUDGET = 6_500          # ~1.5k headroom under the real 8k
IMAGE_TOKEN_COST = 2_048    # documented flat cost of one image

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"], timeout=90.0)
_budget_lock = asyncio.Lock()
_window_start = 0.0
_window_spend = 0

_PROMPT = (
    "Transcribe all text visible in this page image, in reading order. "
    "Preserve the structure you see: keep table rows on one line with their "
    "columns separated by spaces, and keep headings on their own line. "
    "Output ONLY the transcribed text -- no preamble, no commentary, no "
    "description of the image, and no markdown fences. If the page contains no "
    "readable text at all, output nothing."
)


async def _pace(estimated: int):
    """Block until `estimated` tokens fit in the current rolling minute.

    Identical contract to report_generator._pace_for_tokens: an estimate larger
    than the whole budget gets a fresh window to itself rather than deadlocking.
    """
    global _window_start, _window_spend
    while True:
        async with _budget_lock:
            now = time.monotonic()
            if now - _window_start >= 60:
                _window_start = now
                _window_spend = 0
            if _window_spend + estimated <= TPM_BUDGET or (
                _window_spend == 0 and estimated > TPM_BUDGET
            ):
                _window_spend += estimated
                return
            wait = 60 - (now - _window_start)
        wait = max(wait, 1.0)
        print(f"[ARGUS] ocr pacing: waiting {wait:.0f}s for the next token window "
              f"(want {estimated}, spent {_window_spend}/{TPM_BUDGET})")
        await asyncio.sleep(wait)


async def _ocr_one_image(png_bytes: bytes) -> str | None:
    """One vision call. Returns transcribed text, or None on any failure --
    a page that cannot be read must degrade the document, never fail the upload.
    """
    data_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    try:
        await _pace(IMAGE_TOKEN_COST + OCR_MAX_TOKENS)
        completion = await groq_vision_breaker.call(
            _client.chat.completions.create,
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            }],
            max_tokens=OCR_MAX_TOKENS,
            temperature=0,
        )
        text = (completion.choices[0].message.content or "").strip()
        return text or None
    except Exception as err:
        print(f"[ARGUS] ocr page failed (skipping): {err!r}")
        return None


def page_needs_ocr(page_text: str) -> bool:
    return len((page_text or "").strip()) < TEXT_PAGE_MIN_CHARS


async def ocr_pages(doc, page_indexes: list[int]) -> tuple[dict[int, str], int]:
    """OCR the given pages of an open PyMuPDF document.

    Returns ({page_index: text}, attempted) where `attempted` is how many pages
    were actually tried after the cap -- the caller needs it to tell the user
    honestly when a long scan was only partially read.

    Pages are rendered and released ONE AT A TIME. Rendering every page up front
    would be simpler and would also be the fastest way to exhaust a 512MB dyno on
    a long document.
    """
    if not page_indexes:
        return {}, 0

    import fitz  # local import: only needed on the scanned-document path

    capped = page_indexes[:MAX_OCR_PAGES]
    if len(page_indexes) > MAX_OCR_PAGES:
        print(f"[ARGUS] ocr: {len(page_indexes)} image pages, capping at {MAX_OCR_PAGES}")

    results: dict[int, str] = {}
    matrix = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)

    for index in capped:
        pixmap = None
        try:
            pixmap = doc[index].get_pixmap(matrix=matrix)
            png_bytes = pixmap.tobytes("png")
        except Exception as render_err:
            print(f"[ARGUS] ocr: could not render page {index}: {render_err!r}")
            continue
        finally:
            # Drop the pixmap's buffer before the network call, so peak memory is
            # one rendered page rather than one page plus an in-flight request.
            pixmap = None

        text = await _ocr_one_image(png_bytes)
        del png_bytes
        if text:
            results[index] = text
            print(f"[ARGUS] ocr: page {index} -> {len(text)} chars")

    return results, len(capped)
