'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Mail, Lock, Loader2, Eye } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import EyeNetworkBackground from '@/components/effects/EyeNetworkBackground'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const idleSignout = searchParams.get('reason') === 'idle'
  const accountDeleted = searchParams.get('reason') === 'deleted'
  const oauthError = searchParams.get('error') === 'oauth'

  // Account-level theme (2026-07-11): adopt the profile's saved preference on
  // this device at sign-in, so the choice follows the account, not the
  // browser. Applied directly to <html> (localStorage + attributes) because
  // router.push is a client-side navigation -- layout.tsx's inline init
  // script won't re-run. Best-effort: no theme row, no change.
  async function adoptAccountTheme(supabase: ReturnType<typeof createClient>) {
    try {
      const { data } = await supabase.from('user_profiles').select('theme_pref').maybeSingle()
      const pref = data?.theme_pref
      if (pref !== 'light' && pref !== 'dark' && pref !== 'system') return
      window.localStorage.setItem('argus-theme', pref)
      const resolved =
        pref === 'system'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : pref
      document.documentElement.setAttribute('data-theme', resolved)
      document.documentElement.setAttribute('data-theme-pref', pref)
    } catch {
      // Cosmetic only -- never block a login on it.
    }
  }

  async function handleGoogle() {
    setError(null)
    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // Google redirects back to our PKCE callback, which exchanges the code
        // for a session (app/auth/callback/route.ts). window.location.origin
        // works in dev and prod; the exact URL must also be allow-listed in
        // Supabase Auth → URL Configuration (Clint's manual step).
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // prompt=consent forces Google's consent screen -- the "Google will
          // allow ... to access this info / Continue or Cancel" page, with the
          // account shown and a switcher on it -- EVERY time, instead of
          // silently reusing an existing Google session. That confirm/cancel
          // step is exactly what Clint wanted shown on every sign-in
          // (2026-07-13, correcting the earlier select_account, which only
          // showed the account picker and could still skip the consent step).
          queryParams: { prompt: 'consent' },
        },
      })
      if (error) {
        setError(error.message)
        setSubmitting(false)
      }
      // On success the browser navigates away to Google; nothing else runs.
    } catch {
      setError('Could not start Google sign-in. Please try again.')
      setSubmitting(false)
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        return
      }
      // Stamp last_active NOW, before any authenticated request reaches
      // proxy.ts -- makes a fresh login structurally immune to the stale-
      // cookie "?reason=idle on first login" bug (see /auth/activity).
      // Best-effort: if this call fails, proxy.ts still clears stale cookies
      // on unauthenticated requests, so we log in anyway rather than block.
      try {
        await fetch('/auth/activity', { method: 'POST' })
      } catch {
        // Non-fatal by design.
      }
      await adoptAccountTheme(supabase)
      router.push('/dashboard')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  const fieldClass =
    'w-full rounded-md border border-hairline bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface'

  return (
    // Pinned permanently cinematic like the landing (2026-07-16): login is a
    // brand surface, not a reading surface -- the toggle never applies here.
    // The stage class lives on this full-bleed wrapper (NOT the max-w-sm
    // column) so the gradient covers the whole viewport; the fixed canvas
    // pins its palette with theme="dark" for the same reason.
    // `isolate`: same load-bearing stacking fix as the landing root -- the
    // fixed canvas is -z-10, and without a stacking context here the stage
    // gradient background paints over it (negative-z burial).
    <div data-theme="dark" className="stage-cinematic isolate flex min-h-full w-full flex-col">
      <EyeNetworkBackground intensity="app" theme="dark" className="fixed inset-0 -z-10 h-full w-full" />
      <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      {/* Back to the public landing page (live review 2026-07-11: the login
          page was a dead end). */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
        Back to ARGUS
      </Link>

      <div className="rise rounded-2xl border border-hairline bg-surface-raised p-6 shadow-sm">
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-wash text-accent">
            <Eye size={22} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="mt-3 text-sm font-semibold tracking-[0.25em] text-ink">ARGUS</p>
          <h1 className="mt-1 text-lg font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-xs text-ink-muted">Continue to your workspace.</p>
        </div>

        {idleSignout && (
          <p className="mb-3 rounded-md border border-hairline bg-accent-wash p-2 text-xs text-ink-secondary">
            You were signed out after 30 minutes of inactivity. Log in again to continue.
          </p>
        )}
        {oauthError && (
          <p className="mb-3 rounded-md border border-critical-wash bg-critical-wash p-2 text-xs text-ink-secondary">
            Google sign-in didn&apos;t complete. Please try again.
          </p>
        )}
        {accountDeleted && (
          <p className="mb-3 rounded-md border border-critical-wash bg-critical-wash p-2 text-xs text-ink-secondary">
            This account was deleted. Its data is permanently gone and the account can&apos;t be
            restored.
          </p>
        )}

        <button
          type="button"
          onClick={handleGoogle}
          disabled={submitting}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-hairline-strong bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GoogleG />
          Continue with Google
        </button>

        <div className="my-4 flex items-center gap-3 text-xs text-ink-muted">
          <span className="h-px flex-1 bg-hairline" />
          or use email
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <form onSubmit={handleLogin} className="space-y-2">
          <div className="relative">
            <Mail size={15} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <div className="relative">
            <Lock size={15} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 size={15} strokeWidth={2} aria-hidden className="animate-spin" />}
            {submitting ? 'Signing in…' : 'Log in'}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-critical">{error}</p>}
      </div>

      {/* No email/password signup yet (finding #7) -- say so plainly. */}
      <p className="mt-4 px-1 text-center text-xs leading-relaxed text-ink-muted">
        New here? Use <span className="font-medium text-ink-secondary">Continue with Google</span>.
        It creates your account on first sign-in. Email/password signup is coming later.
      </p>
      </main>
    </div>
  )
}

// Google's four-color "G" mark. Inline SVG (no icon library yet, and brand
// marks shouldn't be recolored to a token anyway), so it stays CSP-clean.
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
