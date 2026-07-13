'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Zap } from 'lucide-react'
import { buttonClasses } from '@/components/ui/Button'

// Report-generation popup (#4, 2026-07-14). The Workspace used to show a
// "Generate a report" heading + explainer + two always-visible buttons, which
// Clint found redundant next to the Quick/Full choice. This collapses it to a
// single "Generate report" button that opens a small dialog explaining the two
// modes so the user picks knowingly. Dismissal conventions match ContactModal
// (Escape + outside click). The trigger stays disabled (with a hint) until the
// collection has ready documents -- same guard the buttons had.
export default function ReportGenerateModal({
  onGenerate,
  disabled,
  busy,
}: {
  onGenerate: (mode: 'quick' | 'full') => void
  disabled: boolean
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
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

  function pick(mode: 'quick' | 'full') {
    onGenerate(mode)
    setOpen(false)
  }

  return (
    <div className="rounded-lg border border-hairline bg-surface-page p-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        className={buttonClasses('primary', 'md')}
      >
        <FileText size={16} strokeWidth={1.75} aria-hidden />
        {busy ? 'Starting…' : 'Generate report'}
      </button>
      {disabled && (
        <p className="mt-2 text-xs text-ink-muted">
          Upload a PDF into this collection first, then you can generate a report from it.
        </p>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Generate a report"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-md rounded-2xl border border-hairline bg-surface-raised p-6 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-ink">Generate a report</h3>
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
              ARGUS reads the documents in this collection and writes a formatted draft you can
              preview and download as an editable .docx. Pick how thorough to be. Each counts one
              report toward your daily limit.
            </p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => pick('quick')}
                disabled={busy}
                className="flex w-full items-start gap-3 rounded-lg border border-hairline p-3 text-left transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Zap size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-ink">Quick draft</span>
                  <span className="block text-xs text-ink-secondary">
                    One pass over a representative sample of the documents. Ready in seconds once
                    the server is awake. Best for a fast look.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => pick('full')}
                disabled={busy}
                className="flex w-full items-start gap-3 rounded-lg border border-hairline p-3 text-left transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileText size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="block text-sm font-medium text-ink">Full report</span>
                  <span className="block text-xs text-ink-secondary">
                    Reads everything, paced by the free-tier AI limits, so it takes minutes. More
                    thorough and complete.
                  </span>
                </span>
              </button>
            </div>

            <p className="mt-4 rounded-md bg-accent-wash px-3 py-2 text-xs text-ink-secondary">
              Best on a <span className="font-medium">focused</span> collection. A Full report
              covers roughly the first ~50 pages in depth; beyond that (and always in Quick) it
              reads a representative sample, not every page, and the draft says so. For a large
              corpus, split it into topic-focused collections and generate one report each.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
