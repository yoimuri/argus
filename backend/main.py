import os
import uuid
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.middleware.auth import JWTAuthMiddleware
from app.services.document_processor import extract_chunks_from_pdf_file, iter_embedded_chunk_batches
from app.services.supabase_client import supabase_request

SUPABASE_URL = os.getenv("SUPABASE_URL")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

app = FastAPI()
app.add_middleware(JWTAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://argus-nine-ivory.vercel.app"],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

class DocumentUploadRequest(BaseModel):
    file_path: str
    file_name: str


@app.get("/health")
def health_check():
    return {"status": "ok"}


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
    storage_url = f"{SUPABASE_URL}/storage/v1/object/{req.file_path}"
    headers = {"Authorization": f"Bearer {token}"}
    
    temp_path = f"temp_{uuid.uuid4()}.pdf"
    
    try:
        # 1. Stream download from Supabase Storage directly to disk (0 memory buffer)
        async with httpx.AsyncClient() as client:
            async with client.stream("GET", storage_url, headers=headers) as resp:
                if resp.status_code != 200:
                    raise HTTPException(status_code=400, detail="Failed to fetch file from storage.")
                
                with open(temp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes():
                        f.write(chunk)
        
        # 2. Create document record
        doc_rows = await supabase_request(
            "POST", "documents", request.state.access_token,
            json_body={
                "collection_id": collection_id,
                "user_id": request.state.user_id,
                "filename": req.file_name,
                "status": "processing",
            },
        )
        document = doc_rows[0]

        # 3. Extract chunks using PyMuPDF
        chunk_strings = extract_chunks_from_pdf_file(temp_path)

        # 4. Batch embed + insert
        chunks_created = 0
        async for embedded_batch in iter_embedded_chunk_batches(chunk_strings):
            chunk_rows = [
                {
                    "document_id": document["id"],
                    "user_id": request.state.user_id,
                    "content": c["content"],
                    "embedding": c["embedding"],
                    "chunk_index": c["chunk_index"],
                }
                for c in embedded_batch
            ]
            await supabase_request(
                "POST", "document_chunks", request.state.access_token, json_body=chunk_rows
            )
            chunks_created += len(chunk_rows)

        await supabase_request(
            "PATCH", f"documents?id=eq.{document['id']}", request.state.access_token,
            json_body={"status": "ready"},
        )

    finally:
        # 5. Always clean up the temp file
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {"document_id": document["id"], "chunks_created": chunks_created}


@app.post("/research")
async def research(request: Request):
    body = await request.json()
    query = body.get("query")
    collection_id = body.get("collection_id")
    if not query or not collection_id:
        raise HTTPException(status_code=400, detail="query and collection_id are required.")

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
        "chunks": [],
        "answer": None,
        "report": None,
    })

    return {"report": result["report"], "chunks_used": result["chunks"]}