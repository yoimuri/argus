'use client'

import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { createClient } from '@/utils/supabase/client'
import ReactMarkdown from 'react-markdown'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // matches backend; Render free tier is 512 MB RAM

interface Collection {
  id: string
  name: string
  created_at: string
}

export default function UploadPanel() {
  const [collectionName, setCollectionName] = useState('')
  const [collectionId, setCollectionId] = useState<string | null>(null)
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

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
  }

  // Pure fetch, no setState inside: this can be safely called from both an
  // effect (mount) and a click handler (after create/delete) without either
  // caller's setState-gating rules fighting each other.
  const fetchCollections = useCallback(async (): Promise<Collection[]> => {
    const token = await getToken()
    const res = await fetch(`${API_URL}/collections`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok ? res.json() : []
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

  function resetToCollectionList() {
    setCollectionId(null)
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
      const token = await getToken()
      const res = await fetch(`${API_URL}/collections`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: collectionName }),
      })
      if (!res.ok) {
        setError(`Failed to create collection (${res.status}).`)
        return
      }
      const data = await res.json()
      setCollectionName('')
      setCollectionId(data.id)
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  async function handleDeleteCollection(id: string, name: string) {
    if (!confirm(`Delete collection "${name}" and all its documents? This cannot be undone.`)) {
      return
    }
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/collections/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setError(`Failed to delete collection (${res.status}).`)
        return
      }
      if (collectionId === id) {
        resetToCollectionList()
      }
      setCollections(await fetchCollections())
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`)
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
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const userId = session?.user?.id

      if (!token || !userId) throw new Error('User not authenticated')

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
      const res = await fetch(`${API_URL}/collections/${collectionId}/documents`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({
          file_path: filePath,
          file_name: file.name
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        setError(`Upload failed (${res.status}): ${text}`)
        return
      }
      const data = await res.json()
      const quarantined = data.chunks_quarantined ?? 0
      setStatus(
        quarantined > 0
          ? `Uploaded. ${data.chunks_created} chunks created. ${quarantined} chunk(s) quarantined as potential prompt injection and not stored.`
          : `Uploaded. ${data.chunks_created} chunks created.`,
      )
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`)
    } finally {
      setUploading(false)
    }
  }

  async function handleResearch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setReport(null)
    if (!collectionId || !query) return

    setResearching(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/research`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection_id: collectionId, query }),
      })

      if (!res.ok) {
        const text = await res.text()
        setError(`Research query failed (${res.status}): ${text}`)
        return
      }
      const data = await res.json()
      setReport(data.report)
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`)
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
                  <button type="button" onClick={() => setCollectionId(c.id)}>
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
          <form onSubmit={handleUpload}>
            <p>Collection ready: {collectionId}</p>
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