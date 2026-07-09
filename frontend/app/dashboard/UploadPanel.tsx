'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { createClient } from '@/utils/supabase/client'
import { apiFetch, apiJson, ApiError } from '@/utils/api'
import ReactMarkdown from 'react-markdown'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // matches backend; Render free tier is 512 MB RAM

// Same "(status)." vs "(status): body" vs "network error" split every
// handler below already used before the api.ts refactor (Sprint 4.2, D3) --
// includeBody defaults false to match the handlers that only ever showed the
// status code (create/delete collection, delete document); handleUpload and
// handleResearch pass true since they always showed the raw response text.
function describeError(err: unknown, prefix: string, includeBody = false): string {
  if (err instanceof ApiError) {
    return includeBody ? `${prefix} (${err.status}): ${err.body}` : `${prefix} (${err.status}).`
  }
  return `Network error: ${err instanceof Error ? err.message : 'unknown'}`
}

interface Collection {
  id: string
  name: string
  created_at: string
}

interface DocumentRow {
  id: string
  filename: string
  status: string
  created_at: string
}

export default function UploadPanel() {
  const [collectionName, setCollectionName] = useState('')
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [activeCollectionName, setActiveCollectionName] = useState<string | null>(null)
  // null = loading sentinel (same reasoning as loadingCollections below, but
  // as part of the value itself since this list only exists once a collection is open)
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const [query, setQuery] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [researching, setResearching] = useState(false)

  const [collections, setCollections] = useState<Collection[]>([])
  // Starts true so the first render shows "Loading..." without an effect having
  // to set it synchronously (react-hooks' set-state-in-effect rule flags a
  // setState call that runs unconditionally before any await inside an effect).
  const [loadingCollections, setLoadingCollections] = useState(true)

  // Pure fetch, no setState inside: this can be safely called from both an
  // effect (mount) and a click handler (after create/delete) without either
  // caller's setState-gating rules fighting each other.
  const fetchCollections = useCallback(async (): Promise<Collection[]> => {
    try {
      return await apiJson<Collection[]>('/collections')
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (collectionId) return
    // Canonical React data-fetching-effect pattern (react.dev "You Might Not
    // Need an Effect"): an `ignore` flag set in cleanup, checked before each
    // setState call, so a stale response from a superseded effect run can't
    // overwrite newer state.
    let ignore = false
    fetchCollections()
      .then((data) => {
        if (!ignore) setCollections(data)
      })
      .catch(() => {
        // Best-effort: a failed list fetch shouldn't block creating a new collection.
      })
      .finally(() => {
        if (!ignore) setLoadingCollections(false)
      })
    return () => {
      ignore = true
    }
  }, [collectionId, fetchCollections])

  // Same pure-fetch shape as fetchCollections: callable from the mount effect
  // below AND after a successful upload/delete without setState-gating conflicts.
  const fetchDocuments = useCallback(async (id: string): Promise<DocumentRow[]> => {
    try {
      return await apiJson<DocumentRow[]>(`/collections/${id}/documents`)
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    if (!collectionId) return
    let ignore = false
    fetchDocuments(collectionId)
      .then((data) => {
        if (!ignore) setDocuments(data)
      })
      .catch(() => {
        // Best-effort: a failed list fetch must not block upload/research.
      })
    return () => {
      ignore = true
    }
  }, [collectionId, fetchDocuments])

  function resetToCollectionList() {
    setCollectionId(null)
    setActiveCollectionName(null)
    setDocuments(null)
    setFile(null)
    setQuery('')
    setReport(null)
    setStatus(null)
    setError(null)
  }

  async function handleCreateCollection(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const data = await apiJson<Collection>('/collections', {
        method: 'POST',
        body: JSON.stringify({ name: collectionName }),
      })
      setCollectionName('')
      setActiveCollectionName(data.name)
      setCollectionId(data.id)
    } catch (err) {
      setError(describeError(err, 'Failed to create collection'))
    }
  }

  async function handleDeleteCollection(id: string, name: string) {
    if (!confirm(`Delete collection "${name}" and all its documents? This cannot be undone.`)) {
      return
    }
    setError(null)
    try {
      await apiFetch(`/collections/${id}`, { method: 'DELETE' })
      if (collectionId === id) {
        resetToCollectionList()
      }
      setCollections(await fetchCollections())
    } catch (err) {
      setError(describeError(err, 'Failed to delete collection'))
    }
  }

  function handleFileChange(selected: File | null) {
    setError(null)
    if (!selected) {
      setFile(null)
      return
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null)
      setError(
        `PDF must be under 25 MB (free-tier limit). This file is ${(selected.size / (1024 * 1024)).toFixed(1)} MB.`,
      )
      return
    }
    setFile(selected)
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    if (!collectionId || !file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('PDF must be under 25 MB.')
      return
    }

    setUploading(true)
    try {
      // Storage upload stays a direct Supabase call (api.ts only wraps the
      // Render backend) -- still needs its own session/userId for the file
      // path and the auth check below.
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id

      if (!session || !userId) throw new Error('User not authenticated')

      // 1. Upload the file directly to Supabase Storage
      const filePath = `${userId}/${Date.now()}-${file.name}`
      setStatus('Uploading file to storage...')

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) throw new Error(`Storage error: ${uploadError.message}`)

      // 2. Send ONLY the JSON file path to the Render backend
      setStatus('Processing document...')
      const data = await apiJson<{ document_id: string; chunks_created: number; chunks_quarantined: number }>(
        `/collections/${collectionId}/documents`,
        {
          method: 'POST',
          body: JSON.stringify({ file_path: filePath, file_name: file.name }),
        },
      )
      const quarantined = data.chunks_quarantined ?? 0
      setStatus(
        quarantined > 0
          ? `Uploaded. ${data.chunks_created} chunks created. ${quarantined} chunk(s) quarantined as potential prompt injection and not stored.`
          : `Uploaded. ${data.chunks_created} chunks created.`,
      )
      if (collectionId) setDocuments(await fetchDocuments(collectionId))
    } catch (err) {
      setError(describeError(err, 'Upload failed', true))
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteDocument(id: string, filename: string) {
    if (!confirm(`Delete "${filename}"? Its content will no longer be searchable. This cannot be undone.`)) {
      return
    }
    setError(null)
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' })
      if (collectionId) setDocuments(await fetchDocuments(collectionId))
    } catch (err) {
      setError(describeError(err, 'Failed to delete document'))
    }
  }

  async function handleResearch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setReport(null)
    if (!collectionId || !query) return

    setResearching(true)
    try {
      const data = await apiJson<{ report: string }>('/research', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionId, query }),
      })
      setReport(data.report)
    } catch (err) {
      setError(describeError(err, 'Research query failed', true))
    } finally {
      setResearching(false)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      {!collectionId ? (
        <>
          <form onSubmit={handleCreateCollection}>
            <input
              type="text"
              placeholder="Collection name"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              required
              style={{ marginRight: 8 }}
            />
            <button type="submit">Create collection</button>
          </form>

          <div style={{ marginTop: 20 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Your collections</h3>
            {loadingCollections && <p style={{ color: '#888' }}>Loading...</p>}
            {!loadingCollections && collections.length === 0 && (
              <p style={{ color: '#888' }}>No collections yet. Create one above.</p>
            )}
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {collections.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid #333',
                  }}
                >
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDocuments(null)
                      setActiveCollectionName(c.name)
                      setCollectionId(c.id)
                    }}
                  >
                    Open
                  </button>
                  <button type="button" onClick={() => handleDeleteCollection(c.id, c.name)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={resetToCollectionList} style={{ marginBottom: 12 }}>
            ← Back to collections
          </button>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>{activeCollectionName ?? 'Collection'}</h3>
          <form onSubmit={handleUpload}>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              required
            />
            <p style={{ fontSize: 14, color: '#888', marginTop: 4 }}>
              PDFs up to 25 MB. Large reports (e.g. DBIR) may need a compressed export.
            </p>
            <button type="submit" disabled={uploading}>
              {uploading ? 'Uploading and embedding, this can take a minute...' : 'Upload PDF'}
            </button>
          </form>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Documents</h3>
            {documents === null && <p style={{ color: '#888' }}>Loading...</p>}
            {documents !== null && documents.length === 0 && (
              <p style={{ color: '#888' }}>No documents yet. Upload a PDF above.</p>
            )}
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {(documents ?? []).map((d) => (
                <li
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid #333',
                  }}
                >
                  <span style={{ flex: 1 }}>{d.filename}</span>
                  <span style={{ color: '#888', fontSize: 13 }}>{d.status}</span>
                  <button type="button" onClick={() => handleDeleteDocument(d.id, d.filename)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <form onSubmit={handleResearch} style={{ marginTop: 16 }}>
            <input
              type="text"
              placeholder="Ask a question about this collection"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              required
              style={{ width: '70%', marginRight: 8 }}
            />
            <button type="submit" disabled={researching}>
              {researching ? 'Thinking...' : 'Ask'}
            </button>
          </form>

          {report && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid #444', background: '#111', color: '#fff', borderRadius: 4 }}>
              <ReactMarkdown>{report}</ReactMarkdown>
            </div>
          )}
        </>
      )}
      {status && <p style={{ color: 'green' }}>{status}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}