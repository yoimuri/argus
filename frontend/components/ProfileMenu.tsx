'use client'

import { useEffect, useRef, useState } from 'react'
import ThemeToggle from '@/components/theme/ThemeToggle'

// Profile dropdown (Clint's request, 2026-07-10): the theme toggle moves in
// here from the header bar, alongside account-level items. Only REAL
// destinations get links -- About/Privacy point at the public repo docs that
// actually exist; Settings is explicitly "coming soon" (disabled) rather than
// a dead link, per the docs-never-claim-more-than-the-code rule applied to UI.
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
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-contrast transition-opacity hover:opacity-90"
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
            <span className="text-sm text-ink-secondary">Theme</span>
            <ThemeToggle />
          </div>

          <button
            type="button"
            disabled
            className="block w-full cursor-not-allowed px-3 py-2 text-left text-sm text-ink-muted"
            title="Account settings ship in a later sprint"
          >
            Settings <span className="text-xs">(coming soon)</span>
          </button>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
          >
            About ARGUS ↗
          </a>
          <a
            href={`${REPO_URL}/blob/main/docs/ADR-013.md`}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md px-3 py-2 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
          >
            Privacy posture ↗
          </a>

          <form action="/auth/signout" method="post" className="border-t border-hairline">
            <button
              type="submit"
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-ink-secondary transition-colors hover:bg-critical-wash hover:text-critical"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
