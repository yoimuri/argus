'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

// Fixes the stale-auth CTA bug (live-found 2026-07-11): the landing page is
// server-rendered with the visitor's auth state, but the browser can restore a
// cached copy of it from BEFORE a login/logout (back button, restored page),
// showing "Go to dashboard" to a signed-out visitor until a manual refresh.
// This component takes the server's answer as its starting point, then
// re-checks the real session on the client (a local cookie read, no network)
// and corrects the label if the cached copy is stale. The pageshow listener
// covers the case where the browser unfreezes a fully cached page without
// re-running mount effects.
export default function AuthLink({
  initialAuthed,
  authedLabel,
  anonLabel,
  authedHref = '/dashboard',
  anonHref = '/login',
  className,
}: {
  initialAuthed: boolean
  authedLabel: string
  anonLabel: string
  authedHref?: string
  anonHref?: string
  className?: string
}) {
  const [authed, setAuthed] = useState(initialAuthed)

  useEffect(() => {
    let active = true
    const check = () => {
      createClient()
        .auth.getSession()
        .then(({ data }) => {
          if (active) setAuthed(Boolean(data.session))
        })
        .catch(() => {})
    }
    check()
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) check()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => {
      active = false
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return (
    <Link href={authed ? authedHref : anonHref} className={className} suppressHydrationWarning>
      {authed ? authedLabel : anonLabel}
    </Link>
  )
}
