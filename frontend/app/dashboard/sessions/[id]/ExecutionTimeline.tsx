interface TraceStep {
  step_index: number
  agent_name: string
  status: string
  latency_ms: number
  detail: string | null
  created_at: string
}

// Same fixed-status-color convention as StatusPill/ConfidenceBadge/BreakerPanel
// -- "ok"/"fallback"/"error" are the only three values step_writer.py ever
// writes (record_step's own except-clause hardcodes "error" on an unhandled
// exception, every node's trace_status defaults to "ok" or sets "fallback").
const STEP_STYLE: Record<string, { dot: string; label: string }> = {
  ok: { dot: 'bg-good', label: 'OK' },
  fallback: { dot: 'bg-warning', label: 'Fallback' },
  error: { dot: 'bg-critical', label: 'Error' },
}

// D10: no chart library for 6 steps -- plain CSS bars scaled to the run's
// own max latency (not a fixed scale), so a fast run and a slow run both
// use the full width meaningfully.
export default function ExecutionTimeline({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-ink-muted">No steps recorded yet.</p>
  }

  const maxLatency = Math.max(...steps.map((s) => s.latency_ms), 1)

  return (
    <ol className="space-y-2">
      {steps.map((step) => {
        const style = STEP_STYLE[step.status] ?? { dot: 'bg-ink-muted', label: step.status }
        const widthPct = Math.max(4, Math.round((step.latency_ms / maxLatency) * 100))
        return (
          <li key={step.step_index} className="rounded-lg border border-hairline p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
              <span className="text-sm font-medium text-ink">{step.agent_name}</span>
              <span className="text-xs text-ink-muted">{style.label}</span>
              <span className="ml-auto font-mono text-xs text-ink-secondary">{step.latency_ms} ms</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
              <div className={`h-full rounded-full ${style.dot}`} style={{ width: `${widthPct}%` }} />
            </div>
            {step.detail && (
              <p className="mt-2 truncate font-mono text-xs text-ink-muted" title={step.detail}>
                {step.detail}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
