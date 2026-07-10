'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const idleSignout = searchParams.get('reason') === 'idle'

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
      router.push('/dashboard')
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto mt-16 w-full max-w-xs px-4">
      <h1 className="text-lg font-semibold text-ink">ARGUS Login</h1>
      {idleSignout && (
        <p className="mt-2 rounded-md border border-hairline bg-accent-wash p-2 text-xs text-ink-secondary">
          You were signed out after 30 minutes of inactivity. Log in again to continue.
        </p>
      )}
      <form onSubmit={handleLogin} className="mt-4 space-y-2">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-critical">{error}</p>}
    </main>
  )
}
