'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'

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
// Fix (round 2): layout.tsx's inline script now ALSO stamps the raw
// preference onto <html data-theme-pref>, before <body> ever parses. These
// initializers read that attribute back (not localStorage directly) so the
// client's first hydration render already has the real value -- no
// after-mount correction, no visible flash. This reintroduces a hydration
// mismatch against the server-rendered markup (server always says
// "system"), which is expected and handled: ThemeToggle.tsx applies
// suppressHydrationWarning to the elements whose highlighted state depends
// on this, the officially sanctioned escape hatch for exactly this
// client-only-UI case (same pattern next-themes uses).
// Defaults flipped to dark 2026-07-15 (owner decision -- dark cinematic is
// the brand now; must stay in lockstep with layout.tsx's THEME_INIT_SCRIPT
// fallback and the SSR data-theme="dark" attribute).
function readInitialPreference(): ThemePreference {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.getAttribute('data-theme-pref')
  return attr === 'light' || attr === 'dark' || attr === 'system' ? attr : 'dark'
}

function readInitialResolved(): ResolvedTheme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(readInitialResolved)

  const applyTheme = useCallback((pref: ThemePreference) => {
    const next = resolve(pref)
    setResolvedTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    document.documentElement.setAttribute('data-theme-pref', pref)
  }, [])

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref)
    try {
      window.localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      // Private browsing / storage disabled: theme just won't persist across reloads.
    }
    applyTheme(pref)
    // Account-level persistence (Clint, 2026-07-11: "toggle SAVE, not toggle
    // only"): localStorage keeps the instant-paint job on this browser; the
    // profile row makes the choice follow the account -- LoginForm adopts it
    // on any device at sign-in. Best-effort and fire-and-forget: a signed-out
    // visitor (landing page toggle) or a failed write just stays local.
    const supabase = createClient()
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!user) return
        return supabase.from('user_profiles').update({ theme_pref: pref }).eq('id', user.id)
      })
      .then(() => {})
      .catch(() => {})
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
