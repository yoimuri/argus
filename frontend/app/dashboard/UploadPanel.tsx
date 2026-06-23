'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/utils/supabase/client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

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

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
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
      setCollectionId(data.id)
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : 'unknown'}`)
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    if (!collectionId || !file) return

    setUploading(true)
    try {
      const token = await getToken()
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_URL}/collections/${collectionId}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) {
        const text = await res.text()
        setError(`Upload failed (${res.status}): ${text}`)
        return
      }
      const data = await res.json()
      setStatus(`Uploaded. ${data.chunks_created} chunks created.`)
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
      ) : (
        <>
          <form onSubmit={handleUpload}>
            <p>Collection ready: {collectionId}</p>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
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
            <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, padding: 12, border: '1px solid #444' }}>
              {report}
            </pre>
          )}
        </>
      )}
      {status && <p style={{ color: 'green' }}>{status}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
