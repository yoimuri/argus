'use client'

import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { apiFetch, apiJson, ApiError } from '@/utils/api'
import { splitReport } from '@/utils/report'
import ConfidenceBadge from '@/components/ConfidenceBadge'
import ReactMarkdown from 'react-markdown'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // matches backend; Render free tier is 512 MB RAM

// Every backend error is FastAPI-shaped ({"detail": "human sentence"}), so
// show the user just that sentence -- never the raw JSON (live review
// 2026-07-11: a 429 rendered as `{"detail":"Free-tier limit reached..."}`,
// syntax and all). Falls back to a prefix + status code when the body isn't
// parseable (proxy errors, HTML error pages).
function describeError(err: unknown, prefix: string): string {
  if (err instanceof ApiError) {
    try {
      const detail = (JSON.parse(err.body) as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail) return detail
    } catch {
      // Body wasn't JSON; fall through to the generic form.
    }
    return `${prefix} (${err.status}).`
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

// Cancel signals are sent three times: immediately, +5s, +30s. Covers the
// cold-start race -- if Render's free-tier dyno is still waking when the user
// cancels, the row the signal targets doesn't exist yet (early calls 404
// harmlessly) but the proxy holds the queued request and processes it once
// the dyno is up; a later retry then lands after the backend has created the
// row, so the in-flight work still gets stopped. All attempts fire-and-forget.
// Honest residual: a cold start longer than ~30s can still outrun the last
// retry -- in that rare case the work completes and the doc/session can be
// deleted from its list afterward. Stated in docs/PHASE4.md, not hidden.
function fireCancelSignal(send: () => Promise<unknown>) {
  send().catch(() => {})
  for (const delay of [5000, 30000]) {
    setTimeout(() => {
      send().catch(() => {})
    }, delay)
  }
}

// The query box is a textarea that grows with its content and wraps to the
// next line as it fills (2026-07-10 fix: it used to be a fixed-width
// single-line input that ran off the container). Capped low (Clint: the form
// should stay SHORT) -- past the cap it scrolls internally instead of pushing
// the page down. JS rather than CSS `field-sizing: content` because that
// property isn't in Firefox/Safari yet, and this must work on every device.
const QUERY_MAX_HEIGHT = 120
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
  const router = useRouter()
  const [collectionName, setCollectionName] = useState('')
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [activeCollectionName, setActiveCollectionName] = useState<string | null>(null)
  // null = loading sentinel (same reasoning as loadingCollections below, but
  // as part of the value itself since this list only exists once a collection is open)
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  // Drag-and-drop upload (Clint's request, 2026-07-11): true while a file is
  // being dragged over the dropzone, drives the highlight style only.
  const [dragActive, setDragActive] = useState(false)
  // Local object URL for the in-browser preview (decision #11) -- zero
  // network, revoked whenever the selection changes or the panel unmounts.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadAbortRef = useRef<AbortController | null>(null)
  // Cancel rework (2026-07-10): WE generate the document's uuid and send it
  // with the upload, so Cancel can DELETE /documents/{id} immediately -- the
  // backend polls for that row vanishing between embedding batches. Backend
  // disconnect detection provably doesn't work behind Render's proxy (two
  // prior designs failed live), so the cancel signal lives in the DB instead.
  const uploadDocIdRef = useRef<string | null>(null)

  const [query, setQuery] = useState('')
  const [report, setReport] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [researching, setResearching] = useState(false)
  const researchAbortRef = useRef<AbortController | null>(null)
  // Same trick for research: client-generated session id, known BEFORE the
  // synchronous /research call returns, so Cancel can hit
  // POST /research/{id}/cancel mid-run.
  const researchSessionIdRef = useRef<string | null>(null)
  const queryRef = useRef<HTMLTextAreaElement>(null)

  // Report generation (Sprint 4.6a): the POST returns immediately (the
  // backend generates in a background task) and we navigate to the report
  // page, which polls the row -- so this flag only guards the double-click.
  const [generatingReport, setGeneratingReport] = useState(false)

  const [collections, setCollections] = useState<Collection[]>([])
  // Starts true so the first render shows "Loading..." without an effect having
  // to set it synchronously (react-hooks' set-state-in-effect rule flags a
  // setState call that runs unconditionally before any await inside an effect).
  const [loadingCollections, setLoadingCollections] = useState(true)

  // Workspace usage strip (live review 2026-07-11, finding #1: the caps were
  // only visible on the dashboard, so hitting one mid-work came as a surprise).
  // Limits come from the user's own usage_limits row (RLS-scoped, SELECT-only);
  // the two counts are cheap head-count queries, refetched after any mutation
  // rather than delta-tracked so they can't drift (e.g. deleting a collection
  // cascades an unknown number of documents).
  const [limits, setLimits] = useState<{
    max_collections: number
    max_documents: number
    max_research_per_day: number
    max_reports_per_day: number
  } | null>(null)
  const [docCount, setDocCount] = useState<number | null>(null)
  const [researchToday, setResearchToday] = useState<number | null>(null)
  const [reportsToday, setReportsToday] = useState<number | null>(null)

  const refreshCounts = useCallback(async () => {
    try {
      const supabase = createClient()
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [docs, research, reports] = await Promise.all([
        supabase.from('documents').select('id', { count: 'exact', head: true }),
        // usage_events (migration 014), matching the backend's daily cap source
        // -- research_sessions would undercount after a collection delete.
        supabase
          .from('usage_events')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'research')
          .gte('created_at', since),
        // Report generations (Sprint 4.6a) meter through the same table.
        supabase
          .from('usage_events')
          .select('id', { count: 'exact', head: true })
          .eq('event_type', 'report')
          .gte('created_at', since),
      ])
      setDocCount(docs.count ?? null)
      setResearchToday(research.count ?? null)
      setReportsToday(reports.count ?? null)
    } catch {
      // The strip is informational; a failed count must never break the panel.
    }
  }, [])

  useEffect(() => {
    let ignore = false
    const supabase = createClient()
    supabase
      .from('usage_limits')
      .select('max_collections,max_documents,max_research_per_day,max_reports_per_day')
      .maybeSingle()
      .then(({ data }) => {
        // Missing row -> same tight defaults the backend falls back to.
        if (!ignore)
          setLimits(
            data ?? {
              max_collections: 3,
              max_documents: 15,
              max_research_per_day: 15,
              max_reports_per_day: 3,
            },
          )
      })
    void refreshCounts()
    return () => {
      ignore = true
    }
  }, [refreshCounts])

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

  // Unmount cleanup. 2026-07-11 (Clint): cancellation is now scoped to the
  // Workspace tab only -- switching to another dashboard tab (Dashboard,
  // Sessions, SOC, Settings) no longer kills an in-flight upload/research, so
  // a stray tab click doesn't throw away work; it finishes and shows up in
  // Sessions. Explicit cancellation still lives inside the Workspace: the
  // Cancel buttons and "Back to collections" (resetToCollectionList) both call
  // cancelInFlightWork. Only the object-URL revoke stays here (pure memory
  // hygiene, unrelated to cancelling the request).
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shared by the Cancel buttons, unmount, and collection-switch. The DB
  // write is the real cancel; the abort just settles the local fetch.
  function cancelInFlightWork() {
    const docId = uploadDocIdRef.current
    if (docId) {
      uploadDocIdRef.current = null
      fireCancelSignal(() => apiFetch(`/documents/${docId}`, { method: 'DELETE', keepalive: true }))
    }
    const sid = researchSessionIdRef.current
    if (sid) {
      researchSessionIdRef.current = null
      fireCancelSignal(() => apiFetch(`/research/${sid}/cancel`, { method: 'POST', keepalive: true }))
    }
    uploadAbortRef.current?.abort()
    researchAbortRef.current?.abort()
  }

  function resetToCollectionList() {
    cancelInFlightWork()
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
    // Double-click guard (live-found 2026-07-11: mashing the button fired one
    // POST per click, creating N identical collections). The backend also
    // rejects duplicate names now, but the disabled button is what stops the
    // duplicate REQUESTS from ever leaving the browser.
    if (creatingCollection) return
    setError(null)
    setCreatingCollection(true)
    try {
      const data = await apiJson<Collection>('/collections', {
        method: 'POST',
        body: JSON.stringify({ name: collectionName.trim() }),
      })
      setCollectionName('')
      setActiveCollectionName(data.name)
      setCollectionId(data.id)
    } catch (err) {
      setError(describeError(err, 'Failed to create collection'))
    } finally {
      setCreatingCollection(false)
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
      // Cascade deleted an unknown number of documents -- refetch, don't guess.
      void refreshCounts()
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
    // DB-delete first (the real cancel -- the backend polls for the row
    // vanishing), then abort the local fetch for instant UI feedback.
    const docId = uploadDocIdRef.current
    if (docId) {
      uploadDocIdRef.current = null
      fireCancelSignal(() => apiFetch(`/documents/${docId}`, { method: 'DELETE', keepalive: true }))
    }
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
    const docId = crypto.randomUUID()
    uploadDocIdRef.current = docId
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
      const data = await apiJson<{
        status?: string
        document_id: string
        chunks_created: number
        chunks_quarantined: number
      }>(`/collections/${collectionId}/documents`, {
        method: 'POST',
        body: JSON.stringify({ file_path: filePath, file_name: file.name, document_id: docId }),
        signal: controller.signal,
      })
      if (data.status === 'cancelled') {
        // Backend noticed our cancel-delete mid-processing and stopped.
        setStatus('Upload cancelled.')
        return
      }
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
      else setError(describeError(err, 'Upload failed'))
    } finally {
      setUploading(false)
      uploadAbortRef.current = null
      uploadDocIdRef.current = null
      // Refetch in finally (not only on success): a cancelled upload deletes a
      // row and a completed one adds one -- either way the strip must agree.
      void refreshCounts()
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
      void refreshCounts()
    } catch (err) {
      setError(describeError(err, 'Failed to delete document'))
    }
  }

  function handleCancelResearch() {
    // Flip the DB flag first (the real cancel -- the pipeline checks it
    // before every agent), then abort the local fetch for instant feedback.
    const sid = researchSessionIdRef.current
    if (sid) {
      researchSessionIdRef.current = null
      fireCancelSignal(() => apiFetch(`/research/${sid}/cancel`, { method: 'POST', keepalive: true }))
    }
    researchAbortRef.current?.abort()
  }

  async function handleResearch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setReport(null)
    setSessionId(null)
    setShowDetails(false)
    if (!collectionId || !query.trim()) return

    const controller = new AbortController()
    researchAbortRef.current = controller
    const sid = crypto.randomUUID()
    researchSessionIdRef.current = sid
    setResearching(true)
    try {
      const data = await apiJson<{
        status?: string
        report?: string
        session_id: string | null
      }>('/research', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionId, query, session_id: sid }),
        signal: controller.signal,
      })
      if (data.status === 'cancelled' || !data.report) {
        setStatus('Research cancelled.')
        return
      }
      setReport(data.report)
      setSessionId(data.session_id)
    } catch (err) {
      if (isAbortError(err)) setStatus('Research cancelled.')
      else setError(describeError(err, 'Research query failed'))
    } finally {
      setResearching(false)
      researchAbortRef.current = null
      researchSessionIdRef.current = null
      // Every run (completed, cancelled, or errored) inserted a session row
      // that counts toward the daily cap -- refetch so the strip agrees.
      void refreshCounts()
    }
  }

  // Fix batch #3: two modes. "quick" = one sampled AI call (seconds on a warm
  // server, the default); "full" = the thorough paced pipeline (minutes on
  // free-tier AI limits). Both count one report toward the daily cap.
  async function handleGenerateReport(mode: 'quick' | 'full') {
    if (!collectionId || generatingReport) return
    setError(null)
    setGeneratingReport(true)
    try {
      const data = await apiJson<{ report_id: string }>('/reports', {
        method: 'POST',
        body: JSON.stringify({ collection_id: collectionId, mode }),
      })
      // Counts a usage unit the moment the run starts -- refresh before we
      // navigate so a back-button return shows the right number.
      void refreshCounts()
      router.push(`/dashboard/reports/${data.report_id}`)
    } catch (err) {
      setError(describeError(err, 'Could not start the report'))
      setGeneratingReport(false)
    }
    // No finally-reset on success: we're navigating away; resetting here
    // would blink the button back to enabled for a frame first.
  }

  // Concern 4 (Clint, 2026-07-13): turn the answer we JUST got into a report
  // without re-processing the collection. The completed session already holds
  // the synthesized answer; the backend reuses it (one reduce call), which
  // saves both time and a chunk of the report's generation cost.
  async function handleGenerateFromAnswer() {
    if (!sessionId || generatingReport) return
    setError(null)
    setGeneratingReport(true)
    try {
      const data = await apiJson<{ report_id: string }>('/reports', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      })
      void refreshCounts()
      router.push(`/dashboard/reports/${data.report_id}`)
    } catch (err) {
      setError(describeError(err, 'Could not start the report'))
      setGeneratingReport(false)
    }
  }

  const parsed = report ? splitReport(report) : null
  // "ready" is the only status the retriever can actually search; processing/
  // failed docs don't count toward being able to ask.
  const hasReadyDocs = (documents ?? []).some((d) => d.status === 'ready')

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
      {/* Usage strip (finding #1, 2026-07-11): the same caps the dashboard
          meters show, visible where the work actually happens. Muted normally,
          critical-red once a cap is hit so the coming 429 isn't a surprise. */}
      {limits && (
        <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className={collections.length >= limits.max_collections ? 'font-medium text-critical' : ''}>
            Collections {collections.length}/{limits.max_collections}
          </span>
          {docCount !== null && (
            <span className={docCount >= limits.max_documents ? 'font-medium text-critical' : ''}>
              Documents {docCount}/{limits.max_documents}
            </span>
          )}
          {researchToday !== null && (
            <span className={researchToday >= limits.max_research_per_day ? 'font-medium text-critical' : ''}>
              Research today {researchToday}/{limits.max_research_per_day}
            </span>
          )}
          {reportsToday !== null && (
            <span className={reportsToday >= limits.max_reports_per_day ? 'font-medium text-critical' : ''}>
              Reports today {reportsToday}/{limits.max_reports_per_day}
            </span>
          )}
        </div>
      )}
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
            <button type="submit" disabled={creatingCollection} className={primaryBtn}>
              {creatingCollection ? 'Creating…' : 'Create collection'}
            </button>
          </form>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-secondary">Your collections</h3>
            {loadingCollections && <p className="text-sm text-ink-muted">Loading...</p>}
            {!loadingCollections && collections.length === 0 && (
              <p className="text-sm text-ink-muted">No collections yet. Create one above.</p>
            )}
            {collections.length > 0 && (
              // Capped height + internal scroll: long lists must not stretch
              // the page (2026-07-10 sizing feedback).
              <ul className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
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
              {/* Dropzone (2026-07-11): drag a PDF from the file manager OR use
                  the picker below -- both feed the same handleFileChange path,
                  so the preview-before-upload flow is identical either way. */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragActive(false)
                  const dropped = e.dataTransfer.files?.[0] ?? null
                  if (dropped && dropped.type !== 'application/pdf') {
                    setError('Only PDF files can be uploaded.')
                    return
                  }
                  setError(null)
                  handleFileChange(dropped)
                }}
                className={
                  'rounded-lg border border-dashed p-4 transition-colors ' +
                  (dragActive
                    ? 'border-accent bg-accent-wash'
                    : 'border-hairline bg-surface-page')
                }
              >
                <p className="mb-2 text-xs text-ink-muted">
                  {dragActive ? 'Drop the PDF to select it' : 'Drag a PDF here, or browse:'}
                </p>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  className="block w-full cursor-pointer text-sm text-ink-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-hairline file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-accent-wash"
                />
              </div>
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
              // Fixed height on every breakpoint (2026-07-10 sizing feedback:
              // the container must not stretch with the PDF -- the PDF
              // scrolls inside its own viewer instead).
              <div className="h-[320px] overflow-hidden rounded-lg border border-hairline bg-surface-raised">
                {/* Decision #11: local blob: URL, zero network -- confirm this is
                    the right file before it leaves the browser. <iframe> (not
                    <embed>) so the CSP can allow it via frame-src blob: while
                    object-src stays 'none' (see proxy.ts). */}
                <iframe src={previewUrl} title="PDF preview" className="h-full w-full" />
              </div>
            ) : (
              <div className="hidden h-[320px] items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-page p-6 text-center text-xs text-ink-muted lg:flex">
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
              // Same cap as the collections list -- scrolls internally.
              <ul className="max-h-56 divide-y divide-hairline overflow-y-auto rounded-lg border border-hairline">
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
            {/* No-documents guard (live-found 2026-07-11): asking against an
                empty collection burned a research unit to say "nothing found".
                Blocked on BOTH sides now -- this disables the button with a
                plain reason, and the backend independently rejects with a 400
                before any usage is counted. */}
            {documents !== null && !hasReadyDocs && (
              <p className="rounded-md border border-warning-wash bg-warning-wash p-2 text-xs text-ink-secondary">
                This collection has no ready documents yet. Upload a PDF above before asking —
                otherwise the question has nothing to search.
              </p>
            )}
            <textarea
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onInput={(e) => autoGrowTextarea(e.currentTarget)}
              // Enter submits (chat convention); Shift+Enter inserts a line
              // break. Typing past the width wraps automatically; past the
              // height cap the box scrolls internally instead of growing the
              // page (2026-07-10 feedback: keep this form short and fixed).
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              rows={1}
              required
              placeholder="e.g. What are the top causes of breach in this report? (Enter to ask)"
              className={`${inputClass} max-h-[120px] resize-none overflow-hidden`}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={researching || !query.trim() || !hasReadyDocs}
                className={primaryBtn}
              >
                {researching ? 'Thinking…' : 'Ask'}
              </button>
              {researching && (
                <button type="button" onClick={handleCancelResearch} className={cancelBtn}>
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Report generation (Sprint 4.6a, D17) -- the product's headline:
              a separate flow from Ask. ARGUS reads EVERY document in the
              collection (not just the top search hits), picks a domain-fitting
              report structure, and writes a formatted draft you can download
              as .docx or PDF. Same double-guard convention as Ask: button
              disabled without ready docs, and the backend independently 400s. */}
          <div className="space-y-2 rounded-lg border border-hairline bg-surface-page p-4">
            <h3 className="text-sm font-semibold text-ink-secondary">Generate a report</h3>
            <p className="text-xs text-ink-muted">
              ARGUS turns this collection into a structured, formatted report draft — preview it,
              then download it as .docx or PDF. <span className="text-ink-secondary">Quick
              draft</span> writes from a representative sample of the documents in seconds;{' '}
              <span className="text-ink-secondary">Full report</span> reads everything and takes
              minutes (free-tier AI limits pace it). Each counts one report toward your daily
              limit.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleGenerateReport('quick')}
                disabled={generatingReport || !hasReadyDocs}
                className={primaryBtn}
              >
                {generatingReport ? 'Starting…' : 'Quick draft'}
              </button>
              <button
                type="button"
                onClick={() => handleGenerateReport('full')}
                disabled={generatingReport || !hasReadyDocs}
                className="rounded-md border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                Full report
              </button>
            </div>
          </div>

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
                {sessionId && (
                  <button
                    type="button"
                    onClick={handleGenerateFromAnswer}
                    disabled={generatingReport}
                    className={ghostBtn}
                  >
                    {generatingReport ? 'Starting…' : 'Generate report from this answer'}
                  </button>
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