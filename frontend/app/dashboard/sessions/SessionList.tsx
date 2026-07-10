'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { apiJson, ApiError } from '@/utils/api'
import StatusPill from '@/components/StatusPill'

interface SessionRow {
  id: string
  collection_id: string
  query: string
  status: string
  created_at: string
}

const PAGE_SIZE = 20

export default function SessionList() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Same pure-fetch shape as UploadPanel.tsx's fetchCollections/fetchDocuments
  // -- no setState inside, callable from both the mount effect and the
  // "Load more" button without either caller's setState-gating rules fighting.
  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    const data = await apiJson<SessionRow[]>(`/research?limit=${PAGE_SIZE}&offset=${nextOffset}`)
    setSessions((prev) => (replace ? data : [...prev, ...data]))
    setHasMore(data.length === PAGE_SIZE)
    setOffset(nextOffset + data.length)
  }, [])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(null)
    load(0, true)
      .catch((err) => {
        if (!ignore) setError(err instanceof ApiError ? `Could not load sessions (${err.status}).` : 'Could not load sessions.')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [load])

  async function handleLoadMore() {
    setLoadingMore(true)
    setError(null)
    try {
      await load(offset, false)
    } catch (err) {
      setError(err instanceof ApiError ? `Could not load more (${err.status}).` : 'Could not load more.')
    } finally {
      setLoadingMore(false)
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading sessions...</p>
  if (error && sessions.length === 0) return <p className="text-sm text-critical">{error}</p>
  if (sessions.length === 0) {
    return <p className="text-sm text-ink-muted">No research sessions yet. Ask a question from Workspace to start one.</p>
  }

  return (
    <div>
      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link
              href={`/dashboard/sessions/${s.id}`}
              className="flex items-center gap-3 p-3 text-sm transition-colors hover:bg-accent-wash"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{s.query}</span>
              <StatusPill status={s.status} />
              <span className="shrink-0 text-xs text-ink-muted">
                {new Date(s.created_at).toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="mt-3 rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      )}
      {error && sessions.length > 0 && <p className="mt-2 text-xs text-critical">{error}</p>}
    </div>
  )
}
