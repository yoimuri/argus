import asyncio
import os
import uuid
import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.middleware.auth import JWTAuthMiddleware
from app.services.document_processor import extract_chunks_from_pdf_file, iter_embedded_chunk_batches
from app.services.supabase_client import supabase_request
from app.services.injection_guard import check_query, InjectionDetected
from app.services.injection_patterns import matches_any
from app.services.circuit_breaker import groq_breaker, hf_breaker, hf_embedding_breaker, tavily_breaker, CircuitBreakerOpen
from app.services import observability

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

app = FastAPI()

app.add_middleware(JWTAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    # Locked to the Vercel frontend (prod + preview subdomains) and local dev,
    # instead of the "*" wildcard that used to live here. CORS is not the real
    # security boundary — JWT is (see BLUEPRINT Lesson #4) — but the wildcard
    # contradicted ADR-008 and had no reason to stay. allow_credentials stays
    # False because we authenticate with Bearer tokens, not cookies.
    allow_origin_regex=r"^https://argus[a-z0-9.-]*\.vercel\.app$|^http://localhost:3000$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DocumentUploadRequest(BaseModel):
    file_path: str
    file_name: str
    # Cancel rework (2026-07-10): the CLIENT generates the document's uuid and
    # sends it up front, so its Cancel button can call DELETE /documents/{id}
    # immediately -- without waiting for this synchronous request to return.
    # Two disconnect-based cancel designs failed live before this (uvicorn
    # CancelledError, then request.is_disconnected()): Render's proxy buffers
    # the request/response cycle and never propagates the client abort, so the
    # backend provably cannot SEE a disconnect. An explicit DB-visible signal
    # (the row being deleted) is the only design that doesn't depend on it.
    # Optional: older clients / curl without an id keep working unchanged.
    document_id: Optional[str] = None


def _valid_uuid(value: str) -> bool:
    """An invalid uuid in a PostgREST `eq.` filter returns 400, which
    supabase_request surfaces as a 502 — a garbage id in a URL path should be
    a clean 404 instead, so every id-taking GET/DELETE checks this first."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


# Sprint 4.4 (D13): per-user free-tier caps. These fallback values mirror the
# tight column defaults in migration 011, used only if a user somehow has no
# usage_limits row (trigger failed, or a pre-migration account). Falling back to
# the FREE tier (not "unlimited") means a missing row can never accidentally
# grant unmetered usage -- fail-closed -- while never 500-ing a request either.
DEFAULT_USAGE_LIMITS = {
    "max_collections": 3,
    "max_documents": 15,
    "max_research_per_day": 15,
}


async def _get_usage_limits(user_id, access_token):
    """Read a user's caps. Never raises: a limits-read failure falls back to the
    tight defaults rather than blocking or crashing the request the user was
    actually trying to make."""
    try:
        rows = await supabase_request(
            "GET",
            f"usage_limits?user_id=eq.{user_id}&select=max_collections,max_documents,max_research_per_day",
            access_token,
        )
        if rows:
            return rows[0]
    except Exception as limit_err:
        print(f"[ARGUS] usage-limit read failed for {user_id} (using defaults): {limit_err}")
    return dict(DEFAULT_USAGE_LIMITS)


async def _count_rows(path, access_token):
    """Count rows by selecting ids and taking the length. Fine at free-tier
    magnitudes and avoids adding a count-header path to the shared
    supabase_request helper. RLS already scopes the result to the caller."""
    rows = await supabase_request("GET", path, access_token)
    return len(rows)


async def _mark_document_failed(document, access_token):
    """Best-effort: flip a document row to 'failed' so a crashed upload doesn't
    leave it stuck at 'processing' forever. Never raises — a failed status write
    must not mask the original error that got us here."""
    if not document:
        return
    try:
        await supabase_request(
            "PATCH", f"documents?id=eq.{document['id']}", access_token,
            json_body={"status": "failed"},
        )
    except Exception as patch_err:
        print(f"[ARGUS] could not mark document {document.get('id')} as failed: {patch_err}")


async def _mark_session_error(session_id, access_token, status="error"):
    """Same never-crash stance as _mark_document_failed above: a diary write
    failing here must not mask the real error (or cancellation) that triggered
    the caller's except block. status defaults to "error"; Sprint 4.3's cancel
    support (D15) passes "cancelled" so a killed request is distinguishable
    from a genuine failure in the sessions list / StatusPill.

    The &status=eq.running filter (2026-07-10) makes running -> X the ONLY
    transition this helper can perform: once a session is cancelled (or
    completed), no late error/cleanup path can silently overwrite it."""
    if not session_id:
        return
    try:
        await supabase_request(
            "PATCH", f"research_sessions?id=eq.{session_id}&status=eq.running", access_token,
            json_body={"status": status},
        )
    except Exception as patch_err:
        print(f"[ARGUS] could not mark session {session_id} as {status}: {patch_err}")


async def _delete_partial_chunks(document_id, access_token):
    """Cancel support (D15): match_document_chunks (004_security_and_trust.sql)
    has no documents.status filter -- chunks already embedded for a document
    stay retrievable in search regardless of the parent document's status. A
    cancelled/failed upload must not leave a half-embedded document's chunks
    searchable, so this delete is load-bearing, not just tidiness. Never
    raises, same never-crash stance as its siblings above."""
    if not document_id:
        return
    try:
        await supabase_request(
            "DELETE", f"document_chunks?document_id=eq.{document_id}", access_token,
        )
    except Exception as del_err:
        print(f"[ARGUS] could not delete partial chunks for document {document_id}: {del_err}")


async def _delete_document_fully(document, access_token):
    """Cancel cleanup (Sprint 4.3 rework, 2026-07-10): on a *cancelled* upload,
    remove the document ROW entirely, not just mark it 'failed'. Marking failed
    left a phantom entry that still showed up in the documents list (and, worse,
    a live-found bug where the phantom read 'ready' and then failed every query)
    -- a cancelled upload should leave no trace at all. Chunks first (they have
    no status filter in search), then the row. Never raises."""
    if not document:
        return
    await _delete_partial_chunks(document.get("id"), access_token)
    try:
        await supabase_request(
            "DELETE", f"documents?id=eq.{document['id']}", access_token,
        )
    except Exception as del_err:
        print(f"[ARGUS] could not delete cancelled document {document.get('id')}: {del_err}")


async def _document_still_exists(document_id, access_token) -> bool:
    """Cooperative cancel signal for uploads (2026-07-10 rework): the client's
    Cancel button deletes the documents row directly (it knows the id, it
    generated it), and the processing loop polls THIS between embedding
    batches. Row gone == user cancelled == stop working. A transient failure
    of the check itself must never kill a healthy upload, so it errs True."""
    try:
        rows = await supabase_request(
            "GET", f"documents?id=eq.{document_id}&select=id", access_token,
        )
        return bool(rows)
    except Exception as check_err:
        print(f"[ARGUS] cancel-check failed for document {document_id} (assuming alive): {check_err}")
        return True


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/status/breakers")
async def circuit_breaker_health(request: Request):
    """Live breaker state — all breakers (used to hide hf_prompt_guard). Langfuse
    is reported as an enabled/disabled flag, not a breaker (see observability.py:
    the SDK delivers out-of-band, so there's no request-path failure to guard
    against). Auth-gated (not public) so it isn't a free recon endpoint. Phase
    4's SOC dashboard reads the same snapshot.

    Was /health/circuit-breakers until 2026-07-09: EasyPrivacy (shipped by
    default in Brave Shields, uBlock Origin, and most privacy extensions)
    carries the rule `||onrender.com/health`, which silently blocks any
    browser fetch to a /health* path on any Render-hosted app — the SOC
    panel's request died client-side with net::ERR_BLOCKED_BY_CLIENT before
    ever reaching the network. Renamed so the panel works for every visitor;
    /status/* was verified clean against EasyList/EasyPrivacy/uBlock filters.
    The bare /health above is only hit server-to-server (Render's checks),
    where filter lists don't exist, so it keeps its conventional name."""
    return {
        "groq": await groq_breaker.snapshot(),
        "hf_prompt_guard": await hf_breaker.snapshot(),
        "hf_embedding": await hf_embedding_breaker.snapshot(),
        "tavily": await tavily_breaker.snapshot(),
        "langfuse": observability.snapshot(),
    }


@app.post("/collections")
async def create_collection(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip() or "Untitled Collection"

    # Free-tier cap (D13). Count first, reject with a friendly 429 before the
    # insert if the user is already at their limit.
    limits = await _get_usage_limits(request.state.user_id, request.state.access_token)
    count = await _count_rows(
        f"collections?user_id=eq.{request.state.user_id}&select=id", request.state.access_token
    )
    if count >= limits["max_collections"]:
        raise HTTPException(
            status_code=429,
            detail=f"Free-tier limit reached: {limits['max_collections']} collections max. "
            "Delete one to make room.",
        )

    # Duplicate-name check (live-found 2026-07-11: double-clicking Create made
    # N identical collections). quote() because the name is user text going
    # into a PostgREST query string. Honest note: two truly simultaneous
    # requests can still both pass this check (no DB unique constraint yet);
    # the frontend's disabled-while-creating button covers the realistic case.
    existing = await supabase_request(
        "GET",
        f"collections?user_id=eq.{request.state.user_id}&name=eq.{quote(name)}&select=id",
        request.state.access_token,
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f'You already have a collection named "{name}". Open it from the list below.',
        )

    rows = await supabase_request(
        "POST", "collections", request.state.access_token,
        json_body={"user_id": request.state.user_id, "name": name},
    )
    return rows[0]


@app.get("/collections")
async def list_collections(request: Request):
    # RLS already scopes this to the caller's own rows; the user_id filter here
    # is redundant with the "own collections" policy but costs nothing and makes
    # the intent explicit at the call site.
    rows = await supabase_request(
        "GET",
        f"collections?user_id=eq.{request.state.user_id}&select=id,name,created_at&order=created_at.desc",
        request.state.access_token,
    )
    return rows


@app.delete("/collections/{collection_id}")
async def delete_collection(collection_id: str, request: Request):
    # Right-to-erasure (ADR-013): a user-initiated, complete delete of a
    # collection and everything under it — documents, chunks, and the actual
    # uploaded PDF files in Storage, not just DB rows.
    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&user_id=eq.{request.state.user_id}&select=id",
        request.state.access_token,
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")

    token = request.state.access_token

    # Purge the underlying Storage objects first. Best-effort: a missing or
    # already-gone file must not block deleting the DB rows — the DB delete is
    # the part that actually removes the data from RLS-visible access.
    documents = await supabase_request(
        "GET", f"documents?collection_id=eq.{collection_id}&select=storage_path", token,
    )
    async with httpx.AsyncClient() as client:
        for doc in documents:
            storage_path = doc.get("storage_path")
            if not storage_path:
                continue
            try:
                await client.delete(
                    f"{SUPABASE_URL}/storage/v1/object/documents/{storage_path}",
                    headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY},
                )
            except Exception as storage_err:
                print(f"[ARGUS] could not delete storage object {storage_path}: {storage_err}")

    # Deleting the collection row cascades to documents and document_chunks
    # (on delete cascade in 001_core_schema.sql) — one delete clears the tree.
    await supabase_request("DELETE", f"collections?id=eq.{collection_id}", token)

    return {"status": "deleted", "collection_id": collection_id}


@app.post("/collections/{collection_id}/documents")
async def upload_document(collection_id: str, req: DocumentUploadRequest, request: Request):
    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&select=id", request.state.access_token
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")

    token = request.state.access_token
    user_agent = request.headers.get("user-agent", "")[:300]

    # Free-tier cap (D13): total documents across all of a user's collections.
    # Checked before any storage/embedding work so an over-limit upload costs
    # nothing.
    limits = await _get_usage_limits(request.state.user_id, token)
    doc_count = await _count_rows(
        f"documents?user_id=eq.{request.state.user_id}&select=id", token
    )
    if doc_count >= limits["max_documents"]:
        raise HTTPException(
            status_code=429,
            detail=f"Free-tier limit reached: {limits['max_documents']} documents max. "
            "Delete one to upload another.",
        )

    if req.document_id is not None and not _valid_uuid(req.document_id):
        raise HTTPException(status_code=400, detail="document_id must be a valid uuid.")

    storage_url = f"{SUPABASE_URL}/storage/v1/object/documents/{req.file_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": SUPABASE_KEY
    }

    temp_path = f"temp_{uuid.uuid4()}.pdf"
    document = None
    # False until the embedding loop starts. Failures BEFORE any processing
    # delete the row outright (nothing happened, leave no trace); failures
    # DURING processing keep the row marked 'failed' (real visibility, and
    # what GATE-22's embedding-outage test expects).
    processing_started = False

    try:
        # Create the document row FIRST (2026-07-10 cancel rework) so the
        # client's Cancel button has a target from ~the first moment of the
        # request: cancel == DELETE this row, and the loop below notices the
        # row vanishing between batches. Creating it after the storage
        # download (as before) left a multi-second window where cancel had
        # nothing to delete and the upload completed anyway.
        row_body = {
            "collection_id": collection_id,
            "user_id": request.state.user_id,
            "filename": req.file_name,
            "storage_path": req.file_path,
            "status": "processing",
        }
        if req.document_id:
            row_body["id"] = req.document_id
        doc_rows = await supabase_request("POST", "documents", token, json_body=row_body)
        if not doc_rows:
            raise HTTPException(status_code=500, detail="Failed to create document record in database.")
        document = doc_rows[0]

        # 1. Stream download from Supabase Storage to disk (with size limit)
        downloaded_bytes = 0
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", storage_url, headers=headers) as resp:
                if resp.status_code != 200:
                    error_text = await resp.aread()
                    raise HTTPException(status_code=400, detail=f"Storage fetch failed ({resp.status_code}).")

                with open(temp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes():
                        downloaded_bytes += len(chunk)
                        if downloaded_bytes > MAX_UPLOAD_BYTES:
                            raise HTTPException(status_code=400, detail="File too large (25MB limit).")
                        f.write(chunk)

        # 2. Validate file type using magic bytes before PyMuPDF touches it
        with open(temp_path, "rb") as f:
            header = f.read(4)
        if header != b"%PDF":
            raise HTTPException(status_code=400, detail="File does not appear to be a valid PDF.")

        # 4. Extract chunks using PyMuPDF
        chunk_strings = extract_chunks_from_pdf_file(temp_path)
        if not chunk_strings:
            raise HTTPException(status_code=400, detail="No text could be extracted from the PDF.")

        # 5. Batch embed + shadow-scan + insert.
        # Sprint 2.3 (vector shadow detection): scan each chunk BEFORE it goes
        # into pgvector. A poisoned chunk is quarantined — never inserted, logged
        # to security_events — so it can't be retrieved and fed to the model
        # later. This is the pre-insert twin of the synthesizer's Lock #2 scan;
        # together they mean poisoned content is caught at write time AND read time.
        chunks_created = 0
        quarantined = 0
        processing_started = True
        async for embedded_batch in iter_embedded_chunk_batches(chunk_strings):
            # Cancel check between embedding batches (the slow part): the
            # client's Cancel deleted the row; row gone means stop. Chunks
            # already inserted were removed by that delete's FK cascade, and
            # any straggler insert after it fails on the FK -- either way the
            # end state is no doc, no chunks, nothing to double on re-upload.
            if not await _document_still_exists(document["id"], request.state.access_token):
                print(f"[ARGUS] upload cancelled by client (document {document['id']} deleted), stopping.")
                return {"status": "cancelled", "document_id": document["id"]}
            chunk_rows = []
            for c in embedded_batch:
                if matches_any(c["content"]):
                    quarantined += 1
                    try:
                        await supabase_request(
                            "POST", "security_events", request.state.access_token,
                            json_body={
                                "user_id": request.state.user_id,
                                "event_type": "vector_shadow_quarantined",
                                "source": f"document:{document['id']}:chunk:{c['chunk_index']}",
                                "detail": c["content"][:300],
                                "user_agent": user_agent,
                            },
                        )
                    except Exception as log_err:
                        print(f"[ARGUS] shadow-quarantine log failed: {log_err}")
                    print(f"[ARGUS] Quarantined poisoned chunk {c['chunk_index']} - not inserted.")
                    continue
                chunk_rows.append({
                    "document_id": document["id"],
                    "user_id": request.state.user_id,
                    "content": c["content"],
                    "embedding": c["embedding"],
                    "chunk_index": c["chunk_index"],
                })

            if chunk_rows:
                await supabase_request(
                    "POST", "document_chunks", request.state.access_token, json_body=chunk_rows
                )
                chunks_created += len(chunk_rows)

        # Last cancel check before declaring victory: if the row vanished
        # after the final batch, honor the cancel instead of "ready"-ing a
        # deleted doc (the PATCH below would silently no-op on 0 rows, and
        # we'd return a success payload for a document the user killed).
        if not await _document_still_exists(document["id"], request.state.access_token):
            print(f"[ARGUS] upload cancelled by client at finalization (document {document['id']}).")
            return {"status": "cancelled", "document_id": document["id"]}

        await supabase_request(
            "PATCH", f"documents?id=eq.{document['id']}", request.state.access_token,
            json_body={"status": "ready"},
        )

    except asyncio.CancelledError:
        # Backstop for the rare case the coroutine IS cancelled outright
        # (server shutdown; Render's proxy never delivers client aborts, which
        # is why the row-existence checks above are the primary cancel path).
        # Full-delete so nothing phantom survives, then re-raise (swallowing
        # CancelledError corrupts the server's cancellation bookkeeping).
        await _delete_document_fully(document, request.state.access_token)
        raise
    except HTTPException:
        # Known HTTP errors: if processing had begun, keep the row marked
        # 'failed' (real visibility -- GATE-22's outage test depends on it);
        # if nothing was processed yet (bad storage fetch, not a PDF, no
        # text), delete the row outright so an early failure leaves no junk
        # entry in the documents list.
        if processing_started:
            await _mark_document_failed(document, request.state.access_token)
        else:
            await _delete_document_fully(document, request.state.access_token)
        raise
    except CircuitBreakerOpen as cb_err:
        # HF embedding breaker open (Sprint 4.1, D7/GATE-22): a clean 503 with a
        # retry hint, not a 500 -- the document row is marked failed so it
        # doesn't sit at 'processing' forever, same as any other upload failure.
        await _mark_document_failed(document, request.state.access_token)
        raise HTTPException(
            status_code=503,
            detail=f"Embedding service is temporarily unavailable, retry in ~{cb_err.retry_in_s:.0f}s.",
        )
    except Exception as e:
        import traceback
        traceback.print_exc()  # full detail stays in Render's logs only
        await _mark_document_failed(document, request.state.access_token)
        raise HTTPException(status_code=500, detail="Internal server error processing document.")
            
    finally:
        # 6. Always clean up the temp file to prevent disk exhaustion
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {
        "document_id": document["id"],
        "chunks_created": chunks_created,
        "chunks_quarantined": quarantined,
    }


@app.get("/collections/{collection_id}/documents")
async def list_documents(collection_id: str, request: Request):
    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&select=id", request.state.access_token
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")
    return await supabase_request(
        "GET",
        f"documents?collection_id=eq.{collection_id}"
        "&select=id,filename,status,created_at&order=created_at.asc",
        request.state.access_token,
    )


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str, request: Request):
    if not _valid_uuid(document_id):
        raise HTTPException(status_code=404, detail="Document not found.")

    token = request.state.access_token
    rows = await supabase_request(
        "GET", f"documents?id=eq.{document_id}&select=id,storage_path", token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Document not found.")

    # Best-effort Storage purge first, same stance as delete_collection: a
    # missing file must not block the DB delete, which is what actually
    # removes the chunks from retrieval. Deleting a document mid-research is
    # harmless — chunks already fetched by that run stay in its own memory.
    storage_path = rows[0].get("storage_path")
    if storage_path:
        async with httpx.AsyncClient() as client:
            try:
                await client.delete(
                    f"{SUPABASE_URL}/storage/v1/object/documents/{storage_path}",
                    headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_KEY},
                )
            except Exception as storage_err:
                print(f"[ARGUS] could not delete storage object {storage_path}: {storage_err}")

    # documents row delete cascades to document_chunks (001_core_schema.sql),
    # which is what stops the old PDF's content from being retrievable.
    await supabase_request("DELETE", f"documents?id=eq.{document_id}", token)
    return {"status": "deleted", "document_id": document_id}


@app.post("/research")
async def research(request: Request):
    body = await request.json()
    # Normalize at the entry point: strip leading/trailing whitespace so the exact
    # same string reaches both the orchestrator and (on fail-open) the embedding.
    # A trailing space must never change the answer; trimming here kills that whole
    # class of bug at the source. The guard below then also catches whitespace-only input.
    query = (body.get("query") or "").strip()
    collection_id = body.get("collection_id")
    if not query or not collection_id:
        raise HTTPException(status_code=400, detail="query and collection_id are required.")

    # Cancel rework (2026-07-10): same trick as uploads -- the CLIENT generates
    # the session uuid and sends it up front, because this endpoint is
    # synchronous: without this, the client only learns the session_id when
    # the response returns, which is exactly too late to cancel anything.
    # Optional; a request without one behaves as before (server-generated id).
    client_session_id = body.get("session_id")
    if client_session_id is not None and not _valid_uuid(client_session_id):
        raise HTTPException(status_code=400, detail="session_id must be a valid uuid.")

    # Free-tier cap (D13): research queries per rolling 24h. Checked before the
    # injection classifier and the agent graph so an over-limit request spends
    # no Groq/HF quota -- the whole point of metering. `Z`-suffixed timestamp
    # (not isoformat's `+00:00`) so the `+` can't be mis-read as a space in the
    # PostgREST query string.
    limits = await _get_usage_limits(request.state.user_id, request.state.access_token)
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    research_today = await _count_rows(
        f"research_sessions?user_id=eq.{request.state.user_id}&created_at=gte.{since}&select=id",
        request.state.access_token,
    )
    if research_today >= limits["max_research_per_day"]:
        raise HTTPException(
            status_code=429,
            detail=f"Free-tier limit reached: {limits['max_research_per_day']} research queries per day. "
            "Try again tomorrow.",
        )

    user_agent = request.headers.get("user-agent", "")[:300]

    try:
        await check_query(query, request.state.user_id, request.state.access_token, user_agent)
    except InjectionDetected:
        raise HTTPException(status_code=400, detail="Query blocked, possible prompt injection detected.")

    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&select=id", request.state.access_token
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")

    # Lazy import: langgraph adds ~100MB+ RSS; keep upload path lean on 512MB Render free tier.
    from app.agents.graph import research_graph
    from app.services.step_writer import ResearchCancelled

    # Debug Diary: one research_sessions row per query, patched to its final status
    # once the graph finishes (or errors). Best-effort: if the insert itself fails,
    # the research must still run — session_id stays None and record_step's own
    # try/except (step_writer.py) quietly no-ops on every traced node instead of
    # raising, same never-crash rule applied one level up.
    session_id = None
    try:
        insert_body = {
            "user_id": request.state.user_id,
            "collection_id": collection_id,
            "query": query,
            "status": "running",
        }
        if client_session_id:
            insert_body["id"] = client_session_id
        session_rows = await supabase_request(
            "POST", "research_sessions", request.state.access_token, json_body=insert_body,
        )
        session_id = session_rows[0]["id"]
    except Exception as insert_err:
        print(f"[ARGUS] could not create research_sessions row, diary disabled for this run: {insert_err}")

    # Plain await (2026-07-10, second cancel rework). Two disconnect-based
    # designs failed live before this: uvicorn never raises CancelledError
    # into the handler on client abort, and request.is_disconnected() never
    # flips either, because Render's proxy buffers the request cycle and
    # doesn't propagate the disconnect. Cancellation is now an explicit
    # DB-visible signal instead: POST /research/{id}/cancel flips the session
    # row to 'cancelled', and traced() (step_writer.py) checks that flag
    # before every agent runs, raising ResearchCancelled to stop the graph.
    # Nothing here depends on the proxy behaving.
    try:
        result = await research_graph.ainvoke({
            "query": query,
            "collection_id": collection_id,
            "access_token": request.state.access_token,
            "user_id": request.state.user_id,
            "user_agent": user_agent,
            "session_id": session_id,
            "step_index": 0,
            "intent": "specific",
            "refined_queries": [query],
            "chunks": [],
            "answer": None,
            "report": None,
            "confidence_flags": [],
            "needs_retry": False,
            "loop_count": 0,
            "use_web": False,
            "web_snippets": [],
            "web_status": "not_run",
        })
    except ResearchCancelled:
        # User hit Cancel: the session row already says 'cancelled' (that IS
        # the signal traced() saw), so there is nothing to patch. The client
        # has typically aborted its fetch by now; this response just closes
        # the request cleanly instead of logging a spurious 500.
        return {"status": "cancelled", "session_id": session_id}
    except asyncio.CancelledError:
        # Backstop: the request coroutine itself was cancelled (server
        # shutdown). Mark cancelled (running->cancelled only, see helper) and
        # re-raise -- swallowing CancelledError corrupts the server's
        # cancellation bookkeeping.
        await _mark_session_error(session_id, request.state.access_token, status="cancelled")
        raise
    except CircuitBreakerOpen as cb_err:
        # HF embedding breaker open (Sprint 4.1, D7/GATE-22): the retriever's
        # embed_query call raises this straight out of the graph -- a clean
        # 503 with a retry hint, not a 500. See circuit_breaker.py for why
        # embedding gets its own breaker separate from hf_breaker.
        await _mark_session_error(session_id, request.state.access_token)
        raise HTTPException(
            status_code=503,
            detail=f"Embedding service is temporarily unavailable, retry in ~{cb_err.retry_in_s:.0f}s.",
        )
    except Exception:
        # Best-effort status patch: a diary write failing here must not mask the
        # real error that triggered this except block (same never-crash rule as
        # StepWriter — see app/services/step_writer.py).
        await _mark_session_error(session_id, request.state.access_token)
        raise

    # loop_count >= 2 means the critic ran twice, which only happens after a
    # retry pass fired (graph.py's route_after_critic) — that alone tells us a
    # retry happened, no extra state field needed.
    final_status = "completed_with_fallback" if result.get("loop_count", 0) >= 2 else "completed"

    if session_id:
        try:
            # &status=eq.running: if the user cancelled in the same instant the
            # graph finished, 'cancelled' wins -- a completed report is never
            # silently written over a cancellation (GATE-25: "no report gets
            # written after"). PATCH on 0 matching rows is a clean no-op.
            await supabase_request(
                "PATCH", f"research_sessions?id=eq.{session_id}&status=eq.running", request.state.access_token,
                json_body={"report": result["report"], "status": final_status},
            )
        except Exception as patch_err:
            # A perfectly good answer must still reach the user even if this final
            # diary write fails — the report was already produced.
            print(f"[ARGUS] could not mark session {session_id} as completed: {patch_err}")

    return {
        "report": result["report"],
        "chunks_used": result["chunks"],
        "session_id": session_id,
        "status": final_status,
    }


@app.get("/research")
async def list_research_sessions(
    request: Request,
    collection_id: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
):
    """Sprint 4.1 (D5): session list for the Phase 4 sessions UI. No `/soc/*`
    surface -- this is a plain resource list, same shape as GET /collections.
    Explicit user_id=eq. filter double-scopes on top of RLS's "own sessions"
    policy (GATE-18); an unowned/foreign collection_id just yields no rows
    from that same filter, no separate ownership check needed (GATE-19).
    No report field -- history is metadata-only until a session is opened."""
    limit = max(1, min(limit, 50))
    offset = max(0, offset)

    filters = f"user_id=eq.{request.state.user_id}"
    if collection_id:
        if not _valid_uuid(collection_id):
            return []
        filters += f"&collection_id=eq.{collection_id}"

    return await supabase_request(
        "GET",
        f"research_sessions?{filters}"
        "&select=id,collection_id,query,status,created_at"
        f"&order=created_at.desc&limit={limit}&offset={offset}",
        request.state.access_token,
    )


@app.post("/research/{session_id}/cancel")
async def cancel_research_session(session_id: str, request: Request):
    """Cancel rework (2026-07-10): flips the session to 'cancelled' in the DB.
    This IS the cancel mechanism -- the pipeline's traced() wrapper polls this
    status before each agent and stops when it flips. Disconnect-based designs
    can't work here (Render's proxy never propagates client aborts; two
    attempts failed live). &status=eq.running means only a running session can
    be cancelled: cancelling an already-completed session is a no-op rather
    than destroying a finished report's status. RLS + the 404 below keep it
    scoped to the caller's own sessions, indistinguishable from nonexistent."""
    if not _valid_uuid(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    rows = await supabase_request(
        "GET", f"research_sessions?id=eq.{session_id}&select=id,status",
        request.state.access_token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found.")
    updated = await supabase_request(
        "PATCH", f"research_sessions?id=eq.{session_id}&status=eq.running",
        request.state.access_token,
        json_body={"status": "cancelled"},
    )
    return {
        "session_id": session_id,
        "status": "cancelled" if updated else rows[0]["status"],
    }


@app.delete("/research/{session_id}")
async def delete_research_session(session_id: str, request: Request):
    """Session-history delete (Clint's request, 2026-07-10): a user can remove
    their own past sessions. The row delete cascades to execution_steps
    (008_execution_steps.sql FK), so the trace goes with it. RLS scopes the
    lookup, so foreign and nonexistent ids 404 identically (same pattern as
    every other id-taking route here)."""
    if not _valid_uuid(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    rows = await supabase_request(
        "GET", f"research_sessions?id=eq.{session_id}&select=id",
        request.state.access_token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found.")
    await supabase_request(
        "DELETE", f"research_sessions?id=eq.{session_id}", request.state.access_token,
    )
    return {"status": "deleted", "session_id": session_id}


@app.get("/research/{session_id}")
async def get_research_session(session_id: str, request: Request):
    if not _valid_uuid(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    # RLS scopes the select to the caller's own rows, so "not owned" and
    # "doesn't exist" both come back empty -> identical 404, no ownership leak
    # (same pattern as the collection ownership checks above).
    rows = await supabase_request(
        "GET",
        f"research_sessions?id=eq.{session_id}"
        "&select=id,collection_id,query,report,status,created_at",
        request.state.access_token,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found.")
    return rows[0]


@app.get("/research/{session_id}/trace")
async def get_research_trace(session_id: str, request: Request):
    if not _valid_uuid(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    owned = await supabase_request(
        "GET", f"research_sessions?id=eq.{session_id}&select=id",
        request.state.access_token,
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Session not found.")
    steps = await supabase_request(
        "GET",
        f"execution_steps?session_id=eq.{session_id}"
        "&select=step_index,agent_name,status,latency_ms,detail,created_at"
        "&order=step_index.asc",
        request.state.access_token,
    )
    return {"session_id": session_id, "steps": steps}