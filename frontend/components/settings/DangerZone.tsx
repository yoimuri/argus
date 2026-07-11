'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Danger zone (Clint's request 2026-07-11, GitHub-settings-inspired; design in
// docs/ADR-020.md). Deleting an account is a two-phase flow:
//   1. REQUEST -- type DELETE to confirm; stamps deletion_requested_at on the
//      user's own profile row (client-side write under RLS). Starts a 7-day
//      grace period during which everything still works and a banner offers
//      withdrawal.
//   2. FINALIZE -- after 7 days, the next visit purges all data via the
//      backend and locks the account (DeletionNotice.tsx handles that half).
// This component renders whichever phase applies and handles request/withdraw.
export const DELETION_GRACE_DAYS = 7

export default function DangerZone({
  initialRequestedAt,
}: {
  initialRequestedAt: string | null
}) {
  const [requestedAt, setRequestedAt] = useState<string | null>(initialRequestedAt)
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const deleteBy = requestedAt
    ? new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)
    : null

  async function requestDeletion() {
    if (confirmText !== 'DELETE') return
    setWorking(true)
    setError(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const now = new Date().toISOString()
      const { error: dbError } = await supabase
        .from('user_profiles')
        .update({ deletion_requested_at: now })
        .eq('id', user.id)
      if (dbError) throw dbError
      setRequestedAt(now)
      setConfirmText('')
      router.refresh()
    } catch {
      setError('Could not schedule the deletion. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  async function withdrawDeletion() {
    setWorking(true)
    setError(null)
    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('Not signed in.')
      const { error: dbError } = await supabase
        .from('user_profiles')
        .update({ deletion_requested_at: null })
        .eq('id', user.id)
      if (dbError) throw dbError
      setRequestedAt(null)
      router.refresh()
    } catch {
      setError('Could not withdraw the request. Please try again.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="rounded-lg border border-critical/40 bg-surface">
      <div className="flex items-center gap-2 border-b border-critical/40 px-4 py-3">
        <TriangleAlert size={16} strokeWidth={1.75} className="text-critical" aria-hidden />
        <h2 className="text-sm font-semibold text-critical">Danger zone</h2>
      </div>

      {requestedAt && deleteBy ? (
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-ink">
            This account is scheduled for deletion on{' '}
            <span className="font-semibold text-critical">
              {deleteBy.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
            .
          </p>
          <p className="text-xs text-ink-secondary">
            Until then everything keeps working and you can change your mind. After that date, all
            collections, documents, and research history are permanently deleted and the account
            cannot be restored.
          </p>
          <button
            type="button"
            onClick={withdrawDeletion}
            disabled={working}
            className="cursor-pointer rounded-md border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
          >
            {working ? 'Withdrawing…' : 'Withdraw deletion request'}
          </button>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-ink">Delete this account</p>
          <p className="text-xs text-ink-secondary">
            Schedules the account for permanent deletion after a {DELETION_GRACE_DAYS}-day grace
            period. During those days you can withdraw the request from this page. After that, all
            collections, documents, and research history are permanently removed and the account is
            locked — it cannot be restored.
          </p>
          <label className="block text-xs text-ink-secondary">
            Type <span className="font-mono font-semibold text-critical">DELETE</span> to confirm:
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-critical focus:outline-none"
              placeholder="DELETE"
            />
          </label>
          <button
            type="button"
            onClick={requestDeletion}
            disabled={confirmText !== 'DELETE' || working}
            className="cursor-pointer rounded-md bg-critical px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {working ? 'Scheduling…' : 'Delete account'}
          </button>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-xs text-critical">{error}</p>}
    </section>
  )
}
