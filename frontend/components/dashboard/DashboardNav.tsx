'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderKanban, History, FileText, ShieldCheck, LifeBuoy, GraduationCap, type LucideIcon } from 'lucide-react'

// Dashboard nav extracted to a client component (presentability pass,
// 2026-07-11) so it can highlight the ACTIVE route -- the nav-state-active
// rule: the user's current location must be visually marked, not left
// ambiguous. Icons are Lucide (one family, one stroke width), paired with text
// labels (nav-label-icon: never icon-only nav).
const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/how-to', label: 'How to', icon: GraduationCap },
  { href: '/dashboard/workspace', label: 'Workspace', icon: FolderKanban },
  { href: '/dashboard/sessions', label: 'Sessions', icon: History },
  { href: '/dashboard/reports', label: 'Reports', icon: FileText },
  { href: '/dashboard/soc', label: 'SOC', icon: ShieldCheck },
  { href: '/dashboard/support', label: 'Support', icon: LifeBuoy },
]

export default function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        // Exact match for the overview; prefix match for the others so a
        // session detail page (/dashboard/sessions/[id]) keeps Sessions active.
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            data-tour={href}
            aria-current={active ? 'page' : undefined}
            className={
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors ' +
              (active
                ? 'bg-accent font-medium text-accent-contrast'
                : 'text-ink-secondary hover:bg-accent-wash hover:text-ink')
            }
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
