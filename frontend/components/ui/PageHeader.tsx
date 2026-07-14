import type { ReactNode } from 'react'

// Consistent page title + subtitle block (Sprint 4.7). Every dashboard surface
// opened with a slightly different h1 size/weight/spacing; this fixes the
// typographic rhythm at the top of each page. `actions` sits to the right on
// wide screens, wraps below on narrow ones.
export default function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={'flex flex-wrap items-start justify-between gap-3 ' + className}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}
