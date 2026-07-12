import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// Reusable empty/zero-data state (presentability pass). A consistent, centered
// icon + title + hint (+ optional action) instead of a bare line of muted text,
// applied wherever a list can be empty. One component so every empty state in
// the app reads the same.
export default function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-hairline bg-surface-page px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-wash text-accent">
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-xs text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
