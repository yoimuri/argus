'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'
import { apiFetch } from '@/utils/api'
import { DELETION_GRACE_DAYS } from './DangerZone'

// Rendered by the dashboard layout on every page when a deletion request
// exists (ADR-020). Two modes:
//  - Grace period still running: a persistent banner with the deletion date
//    and a link to Settings (where withdrawal lives). Everything else works.
//  - Grace period expired (or account already marked deleted): finalizes --
//    calls the backend purge (DELETE /account), signs out, and lands on
//    /login?reason=deleted. The purge runs on "next visit after expiry"
//    because there is no scheduler in this stack (no pg_cron; stated in
//    ADR-020) -- the account is unusable from the first expired visit either
//    way, since this component finalizes before the user can do anything else.
export default function DeletionNotice({
  requestedAt,
  accountDeletedAt,
}: {
  requestedAt: string | null
  accountDeletedAt: string | null
}) {
  const [finalizing, setFinalizing] = useState(false)
  const startedRef = useRef(false)

  const deleteBy = requestedAt
    ? new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)
    : null
  const expired = Boolean(accountDeletedAt) || Boolean(deleteBy && Date.now() > deleteBy.getTime())

  useEffect(() => {
    if (!expired || startedRef.current) return
    startedRef.current = true
    setFinalizing(true)
    ;(async () => {
      try {
        // Skip the purge call if it already ran on a previous visit.
        if (!accountDeletedAt) {
          await apiFetch('/account', { method: 'DELETE' })
        }
      } catch {
        // Purge is retried on the next visit; still sign out now -- an
        // expired account must not stay usable.
      }
      try {
        await createClient().auth.signOut()
      } catch {
        // Cookie clear happens on the redirect's login page regardless.
      }
      window.location.assign('/login?reason=deleted')
    })()
  }, [expired, accountDeletedAt])

  if (finalizing || expired) {
    return (
      <div className="border-b border-critical/40 bg-critical-wash px-4 py-2 text-center text-sm text-critical">
        Deleting this account&apos;s data…
      </div>
    )
  }

  if (!deleteBy) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 border-b border-warning-wash bg-warning-wash px-4 py-2 text-sm text-ink">
      <TriangleAlert size={15} strokeWidth={1.75} className="shrink-0 text-warning" aria-hidden />
      <span>
        Account scheduled for deletion on{' '}
        <strong>
          {deleteBy.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
        </strong>
        .
      </span>
      <Link href="/dashboard/settings" className="font-medium text-accent hover:underline">
        Withdraw in Settings
      </Link>
    </div>
  )
}
