'use client'

import { MOTION_KEY, MOTION_OFF_CLASS, useMotionOff } from './motion'

// The visible animation on/off switch. Shown on the landing header, the login
// page and the dashboard header: every page that has the moving background.
// Label + switch are one button so the whole thing is an easy click target.
export default function MotionSwitch({ className = '' }: { className?: string }) {
  const on = !useMotionOff()

  const toggle = () => {
    const next = !on
    document.documentElement.classList.toggle(MOTION_OFF_CLASS, !next)
    try {
      localStorage.setItem(MOTION_KEY, next ? 'on' : 'off')
    } catch {
      // Storage blocked (private mode etc.): the switch still works for this page view.
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title={on ? 'Turn animation off' : 'Turn animation on'}
      className={`inline-flex items-center gap-2 rounded-full border border-hairline-strong px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:border-accent hover:text-ink ${className}`}
    >
      Animation
      <span
        aria-hidden
        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-accent' : 'bg-hairline'}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </span>
    </button>
  )
}
