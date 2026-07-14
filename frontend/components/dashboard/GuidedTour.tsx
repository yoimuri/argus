'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ArrowRight, ArrowLeft, Compass } from 'lucide-react'

// Interactive guided tour (Sprint 4.7, #6). A spotlight walkthrough: it dims the
// app, cuts a "hole" over one real UI element at a time (via a huge box-shadow
// on a div positioned at the element's rect), and shows a tooltip explaining it.
// Targets are the nav items by their data-tour attribute, so the tour points at
// the ACTUAL app chrome, not a mock. Everything is transform/opacity + a scrim,
// reduced-motion-aware, keyboard driven (←/→/Esc), and rendered through a portal
// so no ancestor transform can trap the fixed overlay.
type Step = { selector: string | null; title: string; body: string }

const STEPS: Step[] = [
  {
    selector: null,
    title: 'Welcome to ARGUS',
    body: "A quick tour of what each part does. Use Next and Back, or the arrow keys. Press Esc to leave any time.",
  },
  {
    selector: '[data-tour="/dashboard/workspace"]',
    title: 'Workspace',
    body: 'Start here. Create a collection, upload your PDFs, then ask questions about them or generate a report.',
  },
  {
    selector: '[data-tour="/dashboard/sessions"]',
    title: 'Sessions',
    body: 'Every question you ask is saved here with a step-by-step trace of how the six AI agents reached the answer.',
  },
  {
    selector: '[data-tour="/dashboard/reports"]',
    title: 'Reports',
    body: 'Turn a whole collection into a formatted draft you can preview and download as an editable .docx.',
  },
  {
    selector: '[data-tour="/dashboard/soc"]',
    title: 'SOC',
    body: 'Your live security view: blocked injection attempts and the health of the services ARGUS depends on.',
  },
  {
    selector: '[data-tour="chat"]',
    title: 'The assistant',
    body: 'Stuck on anything? Open the assistant. Ask it "how do I generate a report" and it gives you the steps.',
  },
  {
    selector: null,
    title: "You're set",
    body: 'Head to the Workspace to create your first collection. You can reopen this tour from the How to page any time.',
  },
]

const PAD = 6 // breathing room around the spotlighted element

export default function GuidedTour({ className }: { className?: string }) {
  const [active, setActive] = useState(false)
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const step = STEPS[i]

  const measure = useCallback(() => {
    const sel = STEPS[i]?.selector
    if (!sel) {
      setRect(null)
      return
    }
    const el = document.querySelector(sel)
    if (!el) {
      setRect(null)
      return
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    setRect(el.getBoundingClientRect())
  }, [i])

  useLayoutEffect(() => {
    if (!active) return
    measure()
    const onChange = () => measure()
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [active, measure])

  const stop = useCallback(() => setActive(false), [])
  const prev = useCallback(() => setI((n) => Math.max(0, n - 1)), [])
  // Advance, or close on the last step. Branch here (not inside a state updater)
  // so we never call setActive during setI's render-phase update.
  const advance = useCallback(() => {
    setI((n) => {
      if (n >= STEPS.length - 1) return n
      return n + 1
    })
    setActive((a) => (i >= STEPS.length - 1 ? false : a))
  }, [i])
  const next = advance

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') prev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, stop, next, prev])

  function start() {
    setI(0)
    setActive(true)
  }

  // Tooltip placement: below the target if it sits in the top half of the
  // viewport, otherwise above it. Centered when there's no target (intro/outro).
  let tipStyle: React.CSSProperties = {
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  }
  if (rect) {
    const below = rect.top < window.innerHeight / 2
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - 336)
    tipStyle = below
      ? { left, top: rect.bottom + PAD + 12 }
      : { left, bottom: window.innerHeight - rect.top + PAD + 12 }
  }

  const isLast = i === STEPS.length - 1

  return (
    <>
      <button type="button" onClick={start} className={className}>
        <Compass size={16} strokeWidth={1.75} aria-hidden />
        Take the interactive tour
      </button>

      {active &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Guided tour">
            {/* Click-catcher: keeps the tour modal so a stray click doesn't
                navigate away mid-walkthrough. Clicking the dim = advance. */}
            <button
              type="button"
              aria-label="Next step"
              onClick={next}
              className="absolute inset-0 h-full w-full cursor-default"
            />

            {/* Spotlight hole (only when a target exists). The box-shadow spread
                is the scrim; the ring marks the element. */}
            {rect && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-lg ring-2 ring-accent transition-all duration-200"
                style={{
                  left: rect.left - PAD,
                  top: rect.top - PAD,
                  width: rect.width + PAD * 2,
                  height: rect.height + PAD * 2,
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                }}
              />
            )}
            {/* No-target scrim (intro/outro) */}
            {!rect && <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/55" />}

            {/* Tooltip card */}
            <div
              className="absolute w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-hairline bg-surface-raised p-4 shadow-lg"
              style={tipStyle}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{step.title}</h3>
                <button
                  type="button"
                  onClick={stop}
                  aria-label="Close tour"
                  className="rounded-md p-0.5 text-ink-muted transition-colors hover:bg-accent-wash hover:text-ink"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{step.body}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs tabular-nums text-ink-muted">
                  {i + 1} / {STEPS.length}
                </span>
                <div className="flex items-center gap-2">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={prev}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
                    >
                      <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={next}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                  >
                    {isLast ? 'Done' : 'Next'}
                    {!isLast && <ArrowRight size={14} strokeWidth={2} aria-hidden />}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
