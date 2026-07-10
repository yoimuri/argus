// Shared between SessionList.tsx and SessionDetail.tsx (Sprint 4.3) so a
// session's status reads identically in both places. "cancelled" is new
// this sprint (D15) -- distinct from "error" so a user-initiated stop never
// reads as a system failure.
const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  running: { dot: 'bg-accent', label: 'Running' },
  completed: { dot: 'bg-good', label: 'Completed' },
  completed_with_fallback: { dot: 'bg-warning', label: 'Completed (retry)' },
  error: { dot: 'bg-critical', label: 'Error' },
  cancelled: { dot: 'bg-ink-muted', label: 'Cancelled' },
}

export default function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { dot: 'bg-ink-muted', label: status }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5 text-xs font-medium text-ink-secondary">
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  )
}
