import type { ReactNode } from 'react'

// Shared surface panel (Sprint 4.7 presentability). Before this, every page
// hand-wrote `rounded-lg border border-hairline bg-surface p-4/6`, which drifted
// (p-3 vs p-4 vs p-6, rounded-lg vs -xl). One source of truth now, on the design
// tokens. `interactive` adds the hover-lift + pointer for cards that are links.
export function Card({
  children,
  className = '',
  interactive = false,
  padded = true,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
  padded?: boolean
}) {
  return (
    <div
      className={
        'rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)] ' +
        (padded ? 'p-5 ' : '') +
        (interactive ? 'lift cursor-pointer ' : '') +
        className
      }
    >
      {children}
    </div>
  )
}
