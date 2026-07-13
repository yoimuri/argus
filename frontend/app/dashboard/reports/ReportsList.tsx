'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, TriangleAlert } from 'lucide-react'
import { apiFetch, apiJson, ApiError } from '@/utils/api'
import StatusPill from '@/components/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { buttonClasses } from '@/components/ui/Button'

// Mirrors SessionList.tsx deliberately: same pure-fetch loader, same skeleton
// -> empty-state -> list progression, same delete affordance. A report row is
// history the user owns; the daily-cap accounting lives in usage_events, so
// deleting one never refunds a generation unit (migration 017).
interface ReportRow {
  id: string
  collection_id: string | null
  collection_name: string
  title: string | null
  domain: string | null
  status: string
  created_at: string
}

const PAGE_SIZE = 20

export default function ReportsList() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextOffset: number, replace: boolean) => {
    const data = await apiJson<ReportRow[]>(`/reports?limit=${PAGE_SIZE}&offset=${nextOffset}`)
    setReports((prev) => (replace ? data : [...prev, ...data]))
    setHasMore(data.length === PAGE_SIZE)
    setOffset(nextOffset + data.length)
  }, [])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError(null)
    load(0, true)
      .catch((err) => {
        if (!ignore) setError(err instanceof ApiError ? `Could not load reports (${err.status}).` : 'Could not load reports.')
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

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete the report "${label}"? This cannot be undone.`)) {
      return
    }
    setError(null)
    try {
      await apiFetch(`/reports/${id}`, { method: 'DELETE' })
      setReports((prev) => prev.filter((r) => r.id !== id))
      setOffset((prev) => Math.max(0, prev - 1))
    } catch (err) {
      setError(err instanceof ApiError ? `Could not delete report (${err.status}).` : 'Could not delete report.')
    }
  }

  if (loading) {
    return (
      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 p-3">
            <span className="h-4 flex-1 animate-pulse rounded bg-hairline" />
            <span className="h-4 w-16 animate-pulse rounded bg-hairline" />
          </li>
        ))}
      </ul>
    )
  }
  if (error && reports.length === 0) {
    return <EmptyState icon={TriangleAlert} title="Couldn't load your reports" hint={error} />
  }
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No reports yet"
        hint="Open a collection in the Workspace and choose Generate report. ARGUS reads every document and writes a formatted draft."
        action={
          <Link href="/dashboard/workspace" className={buttonClasses('primary', 'sm')}>
            Go to Workspace
          </Link>
        }
      />
    )
  }

  return (
    <div>
      <ul className="divide-y divide-hairline rounded-lg border border-hairline">
        {reports.map((r) => {
          const label = r.title || `Report: ${r.collection_name || 'Collection'}`
          return (
            <li key={r.id} className="flex items-center gap-2 pr-2">
              <Link
                href={`/dashboard/reports/${r.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 p-3 text-sm transition-colors hover:bg-accent-wash"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
                {r.domain && (
                  <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">{r.domain}</span>
                )}
                <StatusPill status={r.status} />
                <span className="shrink-0 text-xs text-ink-muted">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => handleDelete(r.id, label)}
                className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
              >
                Delete
              </button>
            </li>
          )
        })}
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
      {error && reports.length > 0 && <p className="mt-2 text-xs text-critical">{error}</p>}
    </div>
  )
}
