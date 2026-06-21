import os

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile

from app.middleware.auth import JWTAuthMiddleware
from app.services.document_processor import process_pdf

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]
MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MB

app = FastAPI()
app.add_middleware(JWTAuthMiddleware)


@app.get("/health")
def health_check():
    return {"status": "ok"}


async def supabase_request(method: str, path: str, access_token: str, json_body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    async with httpx.AsyncClient() as client:
        response = await client.request(method, url, json=json_body, headers=headers)
        if response.status_code >= 400:
            # Full detail stays server-side. The caller only gets a generic message,
            # same reasoning as the JWT error logging in auth.py.
            print(f"Supabase request failed: {method} {path} -> {response.status_code}: {response.text}")
            raise HTTPException(status_code=502, detail="Database request failed.")
        return response.json() if response.text else []


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
async def upload_document(collection_id: str, request: Request, file: UploadFile = File(...)):
    # Ownership check: this query runs as the caller's own JWT, so RLS already
    # filters out collections that aren't theirs. Empty result covers both
    # "doesn't exist" and "exists but isn't yours" with the same 404.
    owned = await supabase_request(
        "GET", f"collections?id=eq.{collection_id}&select=id", request.state.access_token
    )
    if not owned:
        raise HTTPException(status_code=404, detail="Collection not found.")

    file_bytes = await file.read()

    if not file_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File does not appear to be a valid PDF.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (20MB limit).")

    doc_rows = await supabase_request(
        "POST", "documents", request.state.access_token,
        json_body={
            "collection_id": collection_id,
            "user_id": request.state.user_id,
            "filename": file.filename,
            "status": "processing",
        },
    )
    document = doc_rows[0]

    chunks = process_pdf(file_bytes)
    chunk_rows = [
        {
            "document_id": document["id"],
            "user_id": request.state.user_id,
            "content": c["content"],
            "embedding": c["embedding"],
            "chunk_index": c["chunk_index"],
        }
        for c in chunks
    ]

    if chunk_rows:
        await supabase_request("POST", "document_chunks", request.state.access_token, json_body=chunk_rows)

    await supabase_request(
        "PATCH", f"documents?id=eq.{document['id']}", request.state.access_token,
        json_body={"status": "ready"},
    )

    return {"document_id": document["id"], "chunks_created": len(chunk_rows)}
