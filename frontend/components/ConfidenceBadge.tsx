import type { ConfidenceLevel } from '@/utils/report'

// Same fixed-status-color convention as BreakerPanel.tsx's STATE_STYLE --
// status colors never follow the theme (dataviz skill, docs/PHASE4.md).
const LEVEL_STYLE: Record<ConfidenceLevel, { wash: string; dot: string; label: string }> = {
  high: { wash: 'bg-good-wash', dot: 'bg-good', label: 'High confidence' },
  low: { wash: 'bg-warning-wash', dot: 'bg-warning', label: 'Low confidence' },
  unassessed: { wash: 'bg-surface', dot: 'bg-ink-muted', label: 'Not assessed' },
}

export default function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const style = LEVEL_STYLE[level]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-xs font-medium text-ink-secondary ${style.wash}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden />
      {style.label}
    </span>
  )
}
