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
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

// Found live 2026-07-09: an earlier version read localStorage inside
// useState's lazy initializer. That function runs fresh on the server
// (window undefined -> falls back to "system") AND on the client's first
// hydration render (window defined -> the real stored value) -- the moment
// a real preference was stored, those two disagreed, and React left the
// *toggle UI* stuck showing the server's "system" guess after a refresh.
// The *actual* theme colors were never wrong, though: those come from the
// inline script in layout.tsx, which mutates data-theme on <html> directly
// and runs entirely outside React, so it was never subject to this
// mismatch -- only the React-rendered toggle was.
//
// Fix: both the server render and the client's first render now start from
// the SAME fixed default (no environment-dependent branching in the initial
// render at all), and the real value is read client-only inside an effect,
// a one-time correction that runs after mount. This causes no visible
// flash -- the colors were already correct before this effect even runs.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  const applyTheme = useCallback((pref: ThemePreference) => {
    const next = resolve(pref)
    setResolvedTheme(next)
    document.documentElement.setAttribute('data-theme', next)
  }, [])

  useEffect(() => {
    try {
      const stored = readStoredPreference()
      setPreferenceState(stored)
      setResolvedTheme(resolve(stored))
    } catch {
      // Private browsing / storage disabled: stay on the "system" default
      // this render already started from.
    }
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
