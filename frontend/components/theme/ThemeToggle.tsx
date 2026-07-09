'use client'

import { useTheme, type ThemePreference } from './ThemeProvider'

const OPTIONS: { value: ThemePreference; label: string; title: string }[] = [
  { value: 'light', label: 'Light', title: 'Light theme' },
  { value: 'dark', label: 'Dark', title: 'Dark theme' },
  { value: 'system', label: 'System', title: 'Match OS setting' },
]

// Three-way, always visible -- user decision was dark+light+system with a
// visible choice, not a two-state cycling toggle that hides "system".
export default function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-surface p-0.5 text-xs"
    >
      {OPTIONS.map((opt) => {
        const active = preference === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => setPreference(opt.value)}
            // ThemeProvider's initial state is read from a DOM attribute the
            // inline script set before hydration (layout.tsx), which is
            // usually already correct on the client's first render --
            // deliberately different from the server-rendered "system"
            // default. suppressHydrationWarning is the React-sanctioned
            // escape hatch for that specific, expected mismatch.
            suppressHydrationWarning
            className={
              'rounded-full px-2.5 py-1 font-medium transition-colors ' +
              (active
                ? 'bg-accent text-accent-contrast'
                : 'text-ink-secondary hover:bg-accent-wash hover:text-ink')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
