'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Palette, Settings, Info, ShieldCheck, LogOut } from 'lucide-react'
import ThemeToggle from '@/components/theme/ThemeToggle'

// Profile dropdown (Clint's request, 2026-07-10; icon + Settings pass
// 2026-07-11). The theme toggle lives here alongside account-level items.
// Settings now points at the real /dashboard/settings page (was a disabled
// "coming soon" stub); About/Privacy still point at repo docs that exist.
const REPO_URL = 'https://github.com/yoimuri/argus'

export default function ProfileMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape -- standard dropdown hygiene.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const initial = (email[0] ?? '?').toUpperCase()

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-contrast transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-50 w-64 rounded-lg border border-hairline bg-surface-raised p-1 shadow-lg"
        >
          <p className="truncate border-b border-hairline px-3 py-2 text-xs text-ink-muted" title={email}>
            {email}
          </p>

          <div className="flex items-center justify-between px-3 py-2">
            <span className="flex items-center gap-2 text-sm text-ink-secondary">
              <Palette size={16} strokeWidth={1.75} aria-hidden />
              Theme
            </span>
            <ThemeToggle />
          </div>

          <Link
            href="/dashboard/settings"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
          >
            <Settings size={16} strokeWidth={1.75} aria-hidden />
            Settings
          </Link>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
          >
            <Info size={16} strokeWidth={1.75} aria-hidden />
            About ARGUS ↗
          </a>
          <a
            href={`${REPO_URL}/blob/main/docs/ADR-013.md`}
            target="_blank"
            rel="noreferrer"
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
          >
            <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
            Privacy posture ↗
          </a>

          <form action="/auth/signout" method="post" className="mt-1 border-t border-hairline pt-1">
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
            >
              <LogOut size={16} strokeWidth={1.75} aria-hidden />
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
