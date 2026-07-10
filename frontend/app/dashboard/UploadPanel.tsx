'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import { apiFetch, apiJson, ApiError } from '@/utils/api'
import { splitReport } from '@/utils/report'
import ConfidenceBadge from '@/components/ConfidenceBadge'
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

// Sprint 4.3 (D15): AbortController.abort() rejects the in-flight fetch with
// a DOMException named "AbortError" -- a real, expected outcome of the user
// clicking Cancel, not a failure. Checked first in both catch blocks so
// cancelling shows a neutral status message instead of red error text.
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// The query box is a textarea that grows with its content and wraps to the
// next line as it fills (2026-07-10 fix: it used to be a fixed-width
// single-line input that ran off the container). Grows up to ~200px, then
// scrolls -- done in JS rather than the CSS `field-sizing: content` property
// because that isn't in Firefox/Safari yet, and this must work on every device.
const QUERY_MAX_HEIGHT = 200
function autoGrowTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, QUERY_MAX_HEIGHT)}px`
  el.style.overflowY = el.scrollHeight > QUERY_MAX_HEIGHT ? 'auto' : 'hidden'
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
  // Local object URL for the in-browser preview (decision #11) -- zero
  // network, revoked whenever the selection changes or the panel unmounts.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadAbortRef = useRef<AbortController | null>(null)

  const [query, setQuery] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [researching, setResearching] = useState(false)
  const researchAbortRef = useRef<AbortController | null>(null)
  const queryRef = useRef<HTMLTextAreaElement>(null)

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

  // previewUrl mirrored into a ref so the unmount-only effect below always
  // revokes the CURRENT object URL, not the one captured at first render --
  // an effect with an empty dep array only runs its body once, so a plain
  // closure over `previewUrl` would stay stuck on its initial (null) value.
  const previewUrlRef = useRef<string | null>(null)
  useEffect(() => {
    previewUrlRef.current = previewUrl
  }, [previewUrl])

  // Sprint 4.3 (D15): navigating away must abort whatever's in flight, not
  // leave it running invisibly. Covers both leaving the panel (unmount) and
  // switching collections (resetToCollectionList, below) while a request
  // is still active.
  useEffect(() => {
    return () => {
      uploadAbortRef.current?.abort()
      researchAbortRef.current?.abort()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  function resetToCollectionList() {
    uploadAbortRef.current?.abort()
    researchAbortRef.current?.abort()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setCollectionId(null)
    setActiveCollectionName(null)
    setDocuments(null)
    setFile(null)
    setPreviewUrl(null)
    setQuery('')
    setReport(null)
    setSessionId(null)
    setShowDetails(false)
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

  // Decision #11 (upload preview): swap the object URL, not just the file --
  // revoke the old one first so repeated re-selection doesn't leak memory.
  function handleFileChange(selected: File | null) {
    setError(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (!selected) {
      setFile(null)
      setPreviewUrl(null)
      return
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFile(null)
      setPreviewUrl(null)
      setError(
        `PDF must be under 25 MB (free-tier limit). This file is ${(selected.size / (1024 * 1024)).toFixed(1)} MB.`,
      )
      return
    }
    setFile(selected)
    setPreviewUrl(URL.createObjectURL(selected))
  }

  function handleCancelUpload() {
    uploadAbortRef.current?.abort()
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

    const controller = new AbortController()
    uploadAbortRef.current = controller
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

      // storage-js's FileOptions has no abort signal (checked against the
      // installed @supabase/storage-js version) -- this leg can't be killed
      // mid-flight. A cancel clicked during it is a "soft" cancel: the
      // upload to Storage still completes, but we never send the resulting
      // file_path to the backend below, so no document/embedding job is
      // created for it and nothing becomes searchable. The AbortController
      // still does real work on step 2 (the backend fetch), which is the
      // expensive, cancellable half (PDF extraction + embedding).
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (controller.signal.aborted) {
        setStatus('Upload cancelled.')
        return
      }

      if (uploadError) throw new Error(`Storage error: ${uploadError.message}`)

      // 2. Send ONLY the JSON file path to the Render backend
      setStatus('Processing document...')
      const data = await apiJson<{ document_id: string; chunks_created: number; chunks_quarantined: number }>(
        `/collections/${collectionId}/documents`,
        {
          method: 'POST',
          body: JSON.stringify({ file_path: filePath, file_name: file.name }),
          signal: controller.signal,
        },
      )
      const quarantined = data.chunks_quarantined ?? 0
      setStatus(
        quarantined > 0
          ? `Uploaded. ${data.chunks_created} chunks created. ${quarantined} chunk(s) quarantined as potential prompt injection and not stored.`
          : `Uploaded. ${data.chunks_created} chunks created.`,
      )
      if (collectionId) setDocuments(await fetchDocuments(collectionId))
      // Clear the selection + preview on success so the same file can't be
      // re-submitted with a second click (an accidental-duplicate vector
      // separate from the cancel-doubling bug, 2026-07-10).
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setFile(null)
      setPreviewUrl(null)
    } catch (err) {
      if (isAbortError(err)) setStatus('Upload cancelled.')
      else setError(describeError(err, 'Upload failed', true))
    } finally {
      setUploading(false)
      uploadAbortRef.current = null
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

  function handleCancelResearch() {
    researchAbortRef.current?.abort()
  }

  async function handleResearch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setReport(null)
    setSessionId(null)
    setShowDetails(false)
    if (!collectionId || !query) return

    const controller = new AbortController()
    researchAbortRef.current = controller
    setResearching(true)
    try {
      const data = await apiJson<{ report: string; session_id: string | null; status: string }>(
        '/research',
        {
          method: 'POST',
          body: JSON.stringify({ collection_id: collectionId, query }),
          signal: controller.signal,
        },
      )
      setReport(data.report)
      setSessionId(data.session_id)
    } catch (err) {
      if (isAbortError(err)) setStatus('Research cancelled.')
      else setError(describeError(err, 'Research query failed', true))
    } finally {
      setResearching(false)
      researchAbortRef.current = null
    }
  }

  const parsed = report ? splitReport(report) : null

  const inputClass =
    'w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none'
  const primaryBtn =
    'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'
  const ghostBtn =
    'rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink'
  const cancelBtn =
    'rounded-md border border-hairline px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical'

  return (
    <div className="mt-6">
      {!collectionId ? (
        <div className="space-y-6">
          <form onSubmit={handleCreateCollection} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              placeholder="Collection name"
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              required
              className={`${inputClass} sm:flex-1`}
            />
            <button type="submit" className={primaryBtn}>
              Create collection
            </button>
          </form>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-secondary">Your collections</h3>
            {loadingCollections && <p className="text-sm text-ink-muted">Loading...</p>}
            {!loadingCollections && collections.length === 0 && (
              <p className="text-sm text-ink-muted">No collections yet. Create one above.</p>
            )}
            {collections.length > 0 && (
              <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                {collections.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 p-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDocuments(null)
                        setActiveCollectionName(c.name)
                        setCollectionId(c.id)
                      }}
                      className={ghostBtn}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCollection(c.id, c.name)}
                      className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={resetToCollectionList} className="text-sm text-accent hover:underline">
              ← Back to collections
            </button>
            <h3 className="text-base font-semibold text-ink">{activeCollectionName ?? 'Collection'}</h3>
          </div>

          {/* Upload: controls left, live PDF preview to the RIGHT on wide
              screens (decision #11 + 2026-07-10 layout fix), stacked on mobile. */}
          <form onSubmit={handleUpload} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-sm font-medium text-ink-secondary">Upload a PDF</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded-md file:border file:border-hairline file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-accent-wash"
              />
              <p className="text-xs text-ink-muted">
                PDFs up to 25 MB. Large reports (e.g. DBIR) may need a compressed export.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={uploading || !file} className={primaryBtn}>
                  {uploading ? 'Uploading and embedding…' : 'Upload PDF'}
                </button>
                {uploading && (
                  <button type="button" onClick={handleCancelUpload} className={cancelBtn}>
                    Cancel
                  </button>
                )}
                {file && !uploading && (
                  <button
                    type="button"
                    onClick={() => handleFileChange(null)}
                    className="rounded-md border border-hairline px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
                  >
                    Choose a different file
                  </button>
                )}
              </div>
            </div>

            {previewUrl ? (
              <div className="overflow-hidden rounded-lg border border-hairline bg-surface-raised">
                {/* Decision #11: local blob: URL, zero network -- confirm this is
                    the right file before it leaves the browser. <iframe> (not
                    <embed>) so the CSP can allow it via frame-src blob: while
                    object-src stays 'none' (see proxy.ts). */}
                <iframe src={previewUrl} title="PDF preview" className="h-[300px] w-full lg:h-full lg:min-h-[300px]" />
              </div>
            ) : (
              <div className="hidden items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-page p-6 text-center text-xs text-ink-muted lg:flex">
                Choose a PDF and it previews here before you upload it.
              </div>
            )}
          </form>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-secondary">Documents</h3>
            {documents === null && <p className="text-sm text-ink-muted">Loading...</p>}
            {documents !== null && documents.length === 0 && (
              <p className="text-sm text-ink-muted">No documents yet. Upload a PDF above.</p>
            )}
            {documents && documents.length > 0 && (
              <ul className="divide-y divide-hairline rounded-lg border border-hairline">
                {documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 p-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{d.filename}</span>
                    <span className="shrink-0 text-xs text-ink-muted">{d.status}</span>
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(d.id, d.filename)}
                      className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={handleResearch} className="space-y-2">
            <label className="block text-sm font-medium text-ink-secondary">
              Ask a question about this collection
            </label>
            <textarea
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onInput={(e) => autoGrowTextarea(e.currentTarget)}
              rows={1}
              required
              placeholder="e.g. What are the top causes of breach in this report?"
              className={`${inputClass} resize-none overflow-hidden`}
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={researching || !query.trim()} className={primaryBtn}>
                {researching ? 'Thinking…' : 'Ask'}
              </button>
              {researching && (
                <button type="button" onClick={handleCancelResearch} className={cancelBtn}>
                  Cancel
                </button>
              )}
            </div>
          </form>

          {parsed && (
            <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-ink">
              <div className="space-y-2 leading-relaxed">
                <ReactMarkdown>{parsed.answer}</ReactMarkdown>
              </div>
              {parsed.banner && (
                <p className="mt-2 text-xs italic text-ink-muted">{parsed.banner.replace(/\*/g, '')}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ConfidenceBadge level={parsed.confidenceLevel} />
                <button type="button" onClick={() => setShowDetails((v) => !v)} className={ghostBtn}>
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                {sessionId && (
                  <Link href={`/dashboard/sessions/${sessionId}`} className="text-xs text-accent hover:underline">
                    View execution trace →
                  </Link>
                )}
              </div>
              {showDetails && (
                <div className="mt-3 space-y-1 border-t border-hairline pt-3 text-ink-secondary">
                  {parsed.sources && (
                    <>
                      <h4 className="mb-1 text-xs font-semibold uppercase text-ink-muted">Sources</h4>
                      <ReactMarkdown>{parsed.sources}</ReactMarkdown>
                    </>
                  )}
                  <h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-ink-muted">Confidence</h4>
                  <ReactMarkdown>{parsed.confidence || 'Not assessed.'}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {status && <p className="mt-3 text-sm text-good">{status}</p>}
      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
    </div>
  )
}