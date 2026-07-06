import os
import uuid
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.middleware.auth import JWTAuthMiddleware
from app.services.document_processor import extract_chunks_from_pdf_file, iter_embedded_chunk_batches
from app.services.supabase_client import supabase_request
from app.services.injection_guard import check_query, InjectionDetected
from app.services.injection_patterns import matches_any
from app.services.circuit_breaker import groq_breaker

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


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/circuit-breakers")
async def circuit_breaker_health(request: Request):
    """Live breaker state. Auth-gated (not public) so it isn't a free recon
    endpoint. Phase 4's SOC dashboard reads the same snapshot."""
    return {"groq": await groq_breaker.snapshot()}


@app.post("/collections")
async def create_collection(request: Request):
    body = await request.json()
    name = body.get("name", "Untitled Collection")
    rows = await supabase_request(
        "POST", "collections", request.state.access_token,
        json_body={"user_id": request.state.user_id, "name": name},
    )
    return rows[0]


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


@app.post("/research")
async def research(request: Request):
    body = await request.json()
    query = body.get("query")
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

    result = await research_graph.ainvoke({
        "query": query,
        "collection_id": collection_id,
        "access_token": request.state.access_token,
        "user_id": request.state.user_id,
        "chunks": [],
        "answer": None,
        "report": None,
    })

    return {"report": result["report"], "chunks_used": result["chunks"]}