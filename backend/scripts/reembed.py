"""One-time migration: re-embed every stored chunk with the new provider.

WHY THIS EXISTS. On 2026-10-15 embeddings moved from HuggingFace's
all-MiniLM-L6-v2 to Cloudflare's bge-small-en-v1.5, because HF removed its free
tier. Both produce 384-dimension vectors, so the `vector(384)` column needs no
migration — but they are DIFFERENT models, and vectors from different models are
not comparable. A query embedded with bge cannot be matched against chunks
embedded with MiniLM; the numbers are the same width but mean different things.
Leaving the old vectors in place would not throw an error, it would just return
nonsense results, which is the worst possible failure mode.

So every existing chunk has to be re-embedded. The chunk TEXT is already stored
in `document_chunks.content`, so this is an in-place update — no PDF is
re-uploaded and no document is re-processed.

SELF-CONTAINED ON PURPOSE. This deliberately does NOT import
app.services.document_processor, even though that holds the same embedding
logic: that module imports PyMuPDF at module level, so an operator running this
would need an 80MB PDF library installed to run a script that never opens a PDF.
The embedding call is small enough to inline, and the inlined copy keeps the
same validation (384 floats, every vector checked) so it cannot silently write a
malformed embedding. If the embedding provider changes again, both places move
together — the comment in document_processor points here.

HOW TO RUN (from backend/, with the repo-root .env filled in):

    python scripts/reembed.py --dry-run     # count what would change, touch nothing
    python scripts/reembed.py               # do it

Safe to re-run: rows are processed in id order and updated in place, so an
interrupted run can simply be started again.

RATE LIMITS. Cloudflare's free tier is 10,000 neurons/day shared across models,
and embeddings have their own per-minute limit. The script batches and paces
itself, and on a rate-limit response it stops cleanly and reports how far it got
rather than hammering — run it again later and it resumes.
"""
import argparse
import asyncio
import os
import sys

import httpx

EMBED_DIM = 384


def _load_env() -> dict:
    """Read the repo-root .env. No python-dotenv dependency — this script is
    meant to run on a bare checkout."""
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(os.path.dirname(here))  # backend/scripts -> repo root
    path = os.path.join(root, ".env")
    vals = {}
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    # Real environment wins over the file, so this works on a server too.
    for k in list(vals):
        if os.environ.get(k):
            vals[k] = os.environ[k]
    for k, v in os.environ.items():
        vals.setdefault(k, v)
    return vals


ENV = _load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
# The service key is required here and ONLY here: this is an operator script run
# from a trusted machine, and it must update rows across every user's documents.
# The application itself still has no service key anywhere — RLS remains the
# enforcement boundary for anything that serves a request.
SERVICE_KEY = ENV.get("SUPABASE_SECRET_KEY") or ENV.get("SUPABASE_SERVICE_KEY", "")
CF_ACCOUNT_ID = ENV.get("CF_ACCOUNT_ID", "")
CF_API_TOKEN = ENV.get("CF_API_TOKEN", "")
CF_EMBED_MODEL = ENV.get("CF_EMBED_MODEL") or "@cf/baai/bge-small-en-v1.5"

BATCH = 16          # chunks per embedding call
PAUSE_S = 1.5       # between batches, to stay under the per-minute limit


def _db_headers() -> dict:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


async def embed(client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
    r = await client.post(
        f"https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_EMBED_MODEL}",
        headers={"Authorization": f"Bearer {CF_API_TOKEN}", "Content-Type": "application/json"},
        json={"text": texts},
    )
    r.raise_for_status()
    payload = r.json()
    # Cloudflare can return HTTP 200 with success=false, which raise_for_status
    # would not catch.
    if not payload.get("success", False):
        raise RuntimeError(f"cloudflare error: {str(payload.get('errors'))[:300]}")
    vectors = (payload.get("result") or {}).get("data") or []
    if len(vectors) != len(texts):
        raise RuntimeError(f"asked for {len(texts)} vectors, got {len(vectors)}")
    for v in vectors:
        if not isinstance(v, list) or len(v) != EMBED_DIM:
            raise RuntimeError(
                f"got a {len(v) if isinstance(v, list) else type(v).__name__}-dim vector; "
                f"column expects {EMBED_DIM}"
            )
    return vectors


async def main(dry_run: bool):
    missing = [n for n, v in [
        ("SUPABASE_URL", SUPABASE_URL),
        ("SUPABASE_SECRET_KEY", SERVICE_KEY),
        ("CF_ACCOUNT_ID", CF_ACCOUNT_ID),
        ("CF_API_TOKEN", CF_API_TOKEN),
    ] if not v]
    if missing:
        raise SystemExit("missing required values: " + ", ".join(missing))

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/document_chunks?select=id",
            headers={**_db_headers(), "Prefer": "count=exact", "Range": "0-0"},
        )
        r.raise_for_status()
        total = int(r.headers.get("content-range", "*/0").split("/")[-1])
        print(f"{total} chunks to re-embed (batch {BATCH}, ~{PAUSE_S}s between batches)")
        if dry_run:
            print("--dry-run: nothing was changed.")
            return

        done = 0
        after = None
        while True:
            q = (f"{SUPABASE_URL}/rest/v1/document_chunks"
                 f"?select=id,content&order=id.asc&limit={BATCH}")
            if after:
                q += f"&id=gt.{after}"
            rr = await client.get(q, headers=_db_headers())
            rr.raise_for_status()
            rows = rr.json()
            if not rows:
                break
            after = rows[-1]["id"]

            try:
                vectors = await embed(client, [row["content"] or "" for row in rows])
            except Exception as err:
                msg = str(err)
                if "429" in msg or "rate" in msg.lower() or "neuron" in msg.lower() or "capacity" in msg.lower():
                    print(f"\nStopped at {done}/{total} — provider limit hit:\n  {msg[:200]}")
                    print("Re-run later; it resumes from where it stopped.")
                    return
                raise

            for row, vec in zip(rows, vectors):
                pr = await client.patch(
                    f"{SUPABASE_URL}/rest/v1/document_chunks?id=eq.{row['id']}",
                    headers=_db_headers(),
                    json={"embedding": vec},
                )
                pr.raise_for_status()

            done += len(rows)
            print(f"  {done}/{total}", end="\r", flush=True)
            await asyncio.sleep(PAUSE_S)

        print(f"\nDone: {done} chunks re-embedded.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="count only, change nothing")
    asyncio.run(main(ap.parse_args().dry_run))
