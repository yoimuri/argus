'use client'

import { useEffect, useRef } from 'react'

// Reveal-on-scroll wrapper for the landing page. See globals.css (.reveal[data-reveal])
// for the safety design: content is visible by default, this component only arms
// the hidden-then-reveal when JS is confirmed running. A broken/absent script can
// never leave content permanently hidden -- the standing "works on ANY browser"
// rule. The element is server-rendered with data-reveal="hidden" so there is no
// visible flash before the observer fires.
export default function Reveal({
  children,
  className = '',
  delayMs = 0,
}: {
  children: React.ReactNode
  className?: string
  delayMs?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Reduced motion: reveal immediately, skip the observer entirely.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.setAttribute('data-reveal', 'shown')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (delayMs) {
              window.setTimeout(() => el.setAttribute('data-reveal', 'shown'), delayMs)
            } else {
              el.setAttribute('data-reveal', 'shown')
            }
            observer.disconnect()
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [delayMs])

  return (
    <div ref={ref} className={`reveal ${className}`.trim()} data-reveal="hidden">
      {children}
    </div>
  )
}
