'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Printer,
  TriangleAlert,
} from 'lucide-react'
import { apiFetch, apiJson, ApiError } from '@/utils/api'
import StatusPill from '@/components/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { buttonClasses } from '@/components/ui/Button'

// Sprint 4.6a (D17): the preview-before-download viewer. Generation runs as a
// backend background task (a run is minutes of model calls -- a synchronous
// request can't be trusted on Render, see ADR-022), so this component POLLS
// the report row until it reaches a terminal state. Cancel is the same
// DB-signal pattern as research: flip the row, the generator notices between
// model calls.
interface Report {
  id: string
  collection_id: string | null
  collection_name: string
  title: string | null
  domain: string | null
  template_source: string | null
  content_md: string | null
  status: string
  created_at: string
}

const POLL_MS = 4000

// Same 3-shot retry pattern as UploadPanel's fireCancelSignal: covers the
// cold-start race where the first signal lands before the dyno is awake.
function fireCancelSignal(send: () => Promise<unknown>) {
  send().catch(() => {})
  for (const delay of [5000, 30000]) {
    setTimeout(() => {
      send().catch(() => {})
    }, delay)
  }
}

const TEMPLATE_SOURCE_LABEL: Record<string, string> = {
  built_in: 'built-in template',
  web_lookup: 'looked-up template',
  general: 'general template',
}

export default function ReportView({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [report, setReport] = useState<Report | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchReport = useCallback(async () => {
    try {
      const data = await apiJson<Report>(`/reports/${reportId}`)
      setReport(data)
      setError(null)
      return data
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        // Transient poll failure (dyno cold start, network blip): keep the
        // last known state on screen rather than replacing it with an error.
        setError('Connection hiccup while checking the report — retrying…')
      }
      return null
    }
  }, [reportId])

  useEffect(() => {
    let ignore = false

    async function tick() {
      const data = await fetchReport()
      if (ignore) return
      if (data && data.status !== 'running' && pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    void tick()
    pollRef.current = setInterval(tick, POLL_MS)
    return () => {
      ignore = true
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchReport])

  function handleCancel() {
    setCancelling(true)
    fireCancelSignal(() => apiFetch(`/reports/${reportId}/cancel`, { method: 'POST', keepalive: true }))
  }

  async function handleDelete() {
    const label = report?.title || 'this report'
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return
    try {
      await apiFetch(`/reports/${reportId}`, { method: 'DELETE' })
      router.push('/dashboard/reports')
    } catch (err) {
      setError(err instanceof ApiError ? `Could not delete report (${err.status}).` : 'Could not delete report.')
    }
  }

  async function handleDownloadDocx() {
    setDownloading(true)
    setError(null)
    try {
      const res = await apiFetch(`/reports/${reportId}/docx`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const safe = (report?.title || 'argus-report').replace(/[^\w \-]/g, '').trim() || 'argus-report'
      a.download = `${safe}.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof ApiError ? `Download failed (${err.status}).` : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  if (notFound) {
    // Foreign and nonexistent ids are indistinguishable by design (RLS) --
    // same wording rule as SessionDetail.
    return <EmptyState icon={TriangleAlert} title="Report not found" hint="It may have been deleted, or the link is wrong." />
  }

  if (!report) {
    return (
      <div className="space-y-3">
        <span className="block h-6 w-2/3 animate-pulse rounded bg-hairline" />
        <span className="block h-4 w-full animate-pulse rounded bg-hairline" />
        <span className="block h-4 w-5/6 animate-pulse rounded bg-hairline" />
      </div>
    )
  }

  const title = report.title || `Report: ${report.collection_name || 'Collection'}`

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Everything except the report body + disclaimer is chrome: hidden in
          print so "Save as PDF" yields a clean document. */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/dashboard/reports" className="flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft size={14} aria-hidden /> All reports
        </Link>
        <StatusPill status={report.status} />
        {report.domain && <span className="text-xs text-ink-muted">{report.domain}</span>}
        {report.template_source && (
          <span className="text-xs text-ink-muted">
            {TEMPLATE_SOURCE_LABEL[report.template_source] ?? report.template_source}
          </span>
        )}
      </div>

      {report.status === 'running' && (
        <div className="rounded-lg border border-hairline bg-surface p-6">
          <div className="flex items-center gap-3">
            <Loader2 size={20} strokeWidth={2} className="animate-spin text-accent" aria-hidden />
            <div>
              <p className="text-sm font-medium text-ink">Generating your report…</p>
              <p className="mt-1 text-xs text-ink-muted">
                ARGUS is reading every document in “{report.collection_name}”, choosing a report
                structure, and writing the draft. This usually takes a few minutes — you can leave
                this page and come back; the report keeps generating.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-4 rounded-md border border-hairline px-4 py-2 text-sm text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel generation'}
          </button>
        </div>
      )}

      {report.status === 'cancelled' && (
        <EmptyState
          icon={FileText}
          title="Generation cancelled"
          hint="This run was stopped before it finished. Generate a new report from the Workspace whenever you're ready."
          action={
            <Link href="/dashboard/workspace" className={buttonClasses('primary', 'sm')}>
              Go to Workspace
            </Link>
          }
        />
      )}

      {report.status === 'error' && (
        <EmptyState
          icon={TriangleAlert}
          title="Generation failed"
          hint="Something went wrong while writing this report (the AI service may have been unavailable, or the run was interrupted). It did not complete — try generating again from the Workspace."
          action={
            <Link href="/dashboard/workspace" className={buttonClasses('primary', 'sm')}>
              Go to Workspace
            </Link>
          }
        />
      )}

      {report.status === 'completed' && report.content_md && (
        <>
          {/* The needs-proofreading disclaimer is part of the design (Clint,
              2026-07-11), not optional copy: always visible in the preview
              AND kept in print output (deliberately NOT print:hidden). */}
          <div className="flex items-start gap-2 rounded-lg border border-warning-wash bg-warning-wash p-3 text-xs leading-relaxed text-ink-secondary">
            <TriangleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <p>
              <strong className="font-semibold text-ink">AI-generated draft — proofread before use.</strong>{' '}
              This report was assembled automatically from your uploaded documents. It can contain
              mistakes, omissions, or misread figures. Review and edit it before sharing or acting
              on it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              onClick={handleDownloadDocx}
              disabled={downloading}
              className={buttonClasses('primary', 'sm')}
            >
              <Download size={14} aria-hidden /> {downloading ? 'Preparing…' : 'Download .docx'}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className={buttonClasses('secondary', 'sm')}
            >
              <Printer size={14} aria-hidden /> Save as PDF
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="rounded-md border border-hairline px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
            >
              Delete
            </button>
          </div>

          <article className="report-body rounded-lg border border-hairline bg-surface p-6 text-sm text-ink-secondary print:border-0 print:p-0">
            <ReactMarkdown>{report.content_md}</ReactMarkdown>
          </article>
        </>
      )}

      {error && <p className="text-xs text-critical print:hidden">{error}</p>}
    </div>
  )
}
