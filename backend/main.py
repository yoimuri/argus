import os
import uuid
import httpx
from typing import Optional
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


def _valid_uuid(value: str) -> bool:
    """An invalid uuid in a PostgREST `eq.` filter returns 400, which
    supabase_request surfaces as a 502 — a garbage id in a URL path should be
    a clean 404 instead, so every id-taking GET/DELETE checks this first."""
    try:
        uuid.UUID(value)
        return True
    except ValueError:
        return False


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


async def _mark_session_error(session_id, access_token):
    """Same never-crash stance as _mark_document_failed above: a diary write
    failing here must not mask the real error that triggered the caller's
    except block."""
    if not session_id:
        return
    try:
        await supabase_request(
            "PATCH", f"research_sessions?id=eq.{session_id}", access_token,
            json_body={"status": "error"},
        )
    except Exception as patch_err:
        print(f"[ARGUS] could not mark session {session_id} as error: {patch_err}")


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
    name = body.get("name", "Untitled Collection")
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
    
    storage_url = f"{SUPABASE_URL}/storage/v1/object/documents/{req.file_path}"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": SUPABASE_KEY
    }
    
    temp_path = f"temp_{uuid.uuid4()}.pdf"
    document = None

    try:
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
        
        # 3. Create document record
        doc_rows = await supabase_request(
            "POST", "documents", request.state.access_token,
            json_body={
                "collection_id": collection_id,
                "user_id": request.state.user_id,
                "filename": req.file_name,
                "storage_path": req.file_path,
                "status": "processing",
            },
        )
        if not doc_rows:
            raise HTTPException(status_code=500, detail="Failed to create document record in database.")
            
        document = doc_rows[0]

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
        async for embedded_batch in iter_embedded_chunk_batches(chunk_strings):
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

        await supabase_request(
            "PATCH", f"documents?id=eq.{document['id']}", request.state.access_token,
            json_body={"status": "ready"},
        )

    except HTTPException:
        # Re-raise known HTTP exceptions so frontend sees the exact error, but if
        # the document row was already created, mark it failed first so it doesn't
        # sit at 'processing' forever.
        await _mark_document_failed(document, request.state.access_token)
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

    try:
        await check_query(query, request.state.user_id, request.state.access_token)
    except InjectionDetected:
        raise HTTPException(status_code=400, detail="Query blocked, possible prompt injection detected.")

    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&select=id", request.state.access_token
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")

    # Lazy import: langgraph adds ~100MB+ RSS; keep upload path lean on 512MB Render free tier.
    from app.agents.graph import research_graph

    # Debug Diary: one research_sessions row per query, patched to its final status
    # once the graph finishes (or errors). Best-effort: if the insert itself fails,
    # the research must still run — session_id stays None and record_step's own
    # try/except (step_writer.py) quietly no-ops on every traced node instead of
    # raising, same never-crash rule applied one level up.
    session_id = None
    try:
        session_rows = await supabase_request(
            "POST", "research_sessions", request.state.access_token,
            json_body={
                "user_id": request.state.user_id,
                "collection_id": collection_id,
                "query": query,
                "status": "running",
            },
        )
        session_id = session_rows[0]["id"]
    except Exception as insert_err:
        print(f"[ARGUS] could not create research_sessions row, diary disabled for this run: {insert_err}")

    try:
        result = await research_graph.ainvoke({
            "query": query,
            "collection_id": collection_id,
            "access_token": request.state.access_token,
            "user_id": request.state.user_id,
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
            await supabase_request(
                "PATCH", f"research_sessions?id=eq.{session_id}", request.state.access_token,
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