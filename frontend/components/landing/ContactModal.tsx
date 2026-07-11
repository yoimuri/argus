'use client'

import { useEffect, useRef, useState } from 'react'

// "Get in touch" contact popup (live review 2026-07-11, finding #4): instead of
// a bare mailto: jump, the button opens a small list of contact channels.
// Same dismissal conventions as ProfileMenu (outside click + Escape).
//
// Planned addition, NOT wired yet: an n8n-automated email form (same setup as
// the portfolio site). Blocked on the n8n webhook URL + a CSP connect-src
// entry for its domain -- see ROADMAP owner notes 2026-07-11. Until then the
// direct channels below are the whole feature; no fake form.
export default function ContactModal({
  email,
  linkedinUrl,
  className,
}: {
  email: string
  linkedinUrl: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be unavailable (permissions, http); the visible address
      // below stays selectable by hand, so failing quietly is fine.
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Get in touch
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Contact details"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-sm rounded-2xl border border-hairline bg-surface-raised p-6 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-ink">Get in touch</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md px-2 py-0.5 text-ink-muted transition-colors hover:bg-accent-wash hover:text-ink"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-sm text-ink-secondary">
              For work inquiries or anything about ARGUS.
            </p>

            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-hairline p-3">
                <p className="text-xs font-medium text-ink-muted">Email</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{email}</span>
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <a
                    href={`mailto:${email}?subject=ARGUS%20inquiry`}
                    className="shrink-0 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                  >
                    Open mail
                  </a>
                </div>
              </div>

              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-hairline p-3 transition-colors hover:bg-accent-wash"
              >
                <p className="text-xs font-medium text-ink-muted">LinkedIn</p>
                <p className="mt-1 text-sm text-ink">Clint Branwel Poyaoan ↗</p>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
