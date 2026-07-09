'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (pref: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'argus-theme'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

// The layout.tsx inline script (nonce'd, runs before paint) reads the same
// localStorage key with the same fallback logic and stamps data-theme on
// <html> before React ever mounts. This lazy initializer reads that same
// source, so the first render never disagrees with what's already painted --
// see Next's "Syncing with React state" guidance in the flash-prevention doc.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(preference))

  const applyTheme = useCallback((pref: ThemePreference) => {
    const next = resolve(pref)
    setResolvedTheme(next)
    document.documentElement.setAttribute('data-theme', next)
  }, [])

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref)
    try {
      window.localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      // Private browsing / storage disabled: theme just won't persist across reloads.
    }
    applyTheme(pref)
  }, [applyTheme])

  // "system" reacts live to an OS-level theme change while the tab stays
  // open, not just at load -- only listens while that's the active choice.
  useEffect(() => {
    if (preference !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [preference, applyTheme])

  return (
    <ThemeContext.Provider value={{ preference, resolvedTheme, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}

// Exported so layout.tsx's inline script and this provider can never drift
// apart on where the preference lives or how "system" resolves.
export const THEME_STORAGE_KEY = STORAGE_KEY
