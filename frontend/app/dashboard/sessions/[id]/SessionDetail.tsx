'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { apiJson, ApiError } from '@/utils/api'
import { splitReport } from '@/utils/report'
import StatusPill from '@/components/StatusPill'
import ConfidenceBadge from '@/components/ConfidenceBadge'
import ExecutionTimeline from './ExecutionTimeline'

interface SessionData {
  id: string
  collection_id: string
  query: string
  report: string | null
  status: string
  created_at: string
}

interface TraceStep {
  step_index: number
  agent_name: string
  status: string
  latency_ms: number
  detail: string | null
  created_at: string
}

const POLL_MS = 4000

export default function SessionDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<SessionData | null>(null)
  const [steps, setSteps] = useState<TraceStep[]>([])
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Parallel fetch, both endpoints independently 404 for "not owned" OR
  // "doesn't exist" (RLS makes the two indistinguishable) -- Promise.all
  // rejecting on either means "Session not found" without leaking which.
  const load = useCallback(async () => {
    const [sessionData, traceData] = await Promise.all([
      apiJson<SessionData>(`/research/${sessionId}`),
      apiJson<{ session_id: string; steps: TraceStep[] }>(`/research/${sessionId}/trace`),
    ])
    setSession(sessionData)
    setSteps(traceData.steps)
  }, [sessionId])

  useEffect(() => {
    let ignore = false
    load()
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 404) setNotFound(true)
        else setError('Could not load this session.')
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [load])

  // Separate effect: poll only while the session is actually still running
  // (D4) -- a finished session's page goes idle instead of polling forever.
  useEffect(() => {
    if (!session || session.status !== 'running') return
    const interval = setInterval(() => {
      load().catch(() => {
        // Transient poll failure -- keep showing the last good data, retry next tick.
      })
    }, POLL_MS)
    return () => clearInterval(interval)
  }, [session, load])

  if (loading) return <p className="text-sm text-ink-muted">Loading session...</p>

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/sessions" className="text-sm text-accent hover:underline">
          ← Back to sessions
        </Link>
        <p className="text-sm text-ink-muted">Session not found.</p>
      </div>
    )
  }

  if (error || !session) {
    return <p className="text-sm text-critical">{error ?? 'Could not load this session.'}</p>
  }

  const parsed = session.report ? splitReport(session.report) : null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/sessions" className="text-sm text-accent hover:underline">
          ← Back to sessions
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-ink">{session.query}</h1>
          <StatusPill status={session.status} />
        </div>
        <p className="mt-1 text-xs text-ink-muted">{new Date(session.created_at).toLocaleString()}</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Execution trace</h2>
        <ExecutionTimeline steps={steps} />
      </section>

      {parsed && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Report</h2>
          <div className="rounded-lg border border-hairline bg-surface p-4 text-sm text-ink">
            <ReactMarkdown>{parsed.answer}</ReactMarkdown>
            {parsed.banner && (
              <p className="mt-2 text-xs italic text-ink-muted">{parsed.banner.replace(/\*/g, '')}</p>
            )}
            <div className="mt-3">
              <ConfidenceBadge level={parsed.confidenceLevel} />
            </div>
            {parsed.sources && (
              <div className="mt-3 border-t border-hairline pt-3 text-ink-secondary">
                <h3 className="mb-1 text-xs font-semibold uppercase text-ink-muted">Sources</h3>
                <ReactMarkdown>{parsed.sources}</ReactMarkdown>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
