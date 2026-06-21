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

  async function getToken() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token
  }

  async function handleCreateCollection(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const token = await getToken()
    const res = await fetch(`${API_URL}/collections`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: collectionName }),
    })
    if (!res.ok) {
      setError('Failed to create collection.')
      return
    }
    const data = await res.json()
    setCollectionId(data.id)
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setStatus(null)
    if (!collectionId || !file) return

    const token = await getToken()
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`${API_URL}/collections/${collectionId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })

    if (!res.ok) {
      setError('Upload failed.')
      return
    }
    const data = await res.json()
    setStatus(`Uploaded. ${data.chunks_created} chunks created.`)
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
        <form onSubmit={handleUpload}>
          <p>Collection ready: {collectionId}</p>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <button type="submit">Upload PDF</button>
        </form>
      )}
      {status && <p style={{ color: 'green' }}>{status}</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
