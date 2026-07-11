'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TriangleAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

// Danger zone (Clint's request 2026-07-11, GitHub-settings row pattern; design
// in docs/ADR-020.md). Deleting an account is a two-phase flow:
//   1. REQUEST -- clicking "Delete account" pops out a confirmation dialog
//      (type DELETE to confirm), same GitHub convention: the destructive
//      action is never one click, and the typed confirmation is gated behind
//      an explicit "I want to do this" click first, not shown inline by
//      default. Confirming stamps deletion_requested_at on the user's own
//      profile row (client-side write under RLS). Starts a 7-day grace period
//      during which everything still works and a banner offers withdrawal.
//   2. FINALIZE -- after 7 days, the next visit purges all data via the
//      backend and locks the account (DeletionNotice.tsx handles that half).
export const DELETION_GRACE_DAYS = 7

export default function DangerZone({
  initialRequestedAt,
}: {
  initialRequestedAt: string | null
}) {
  const [requestedAt, setRequestedAt] = useState<string | null>(initialRequestedAt)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const deleteBy = requestedAt
    ? new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000)
    : null

  useEffect(() => {
    if (!confirmOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeConfirm()
    }
    function onClick(e: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) closeConfirm()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen])

  function closeConfirm() {
    setConfirmOpen(false)
    setConfirmText('')
    setError(null)
  }

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
      closeConfirm()
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
    <>
      <section className="rounded-lg border border-critical/40 bg-surface">
        <div className="flex items-center gap-2 border-b border-critical/40 px-4 py-3">
          <TriangleAlert size={16} strokeWidth={1.75} className="text-critical" aria-hidden />
          <h2 className="text-sm font-semibold text-critical">Danger zone</h2>
        </div>

        {/* GitHub-style row: label + description left, action button right. */}
        {requestedAt && deleteBy ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-ink">Account scheduled for deletion</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Permanently deleted on{' '}
                <span className="font-medium text-critical">
                  {deleteBy.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
                . Withdraw before then to keep everything.
              </p>
            </div>
            <button
              type="button"
              onClick={withdrawDeletion}
              disabled={working}
              className="shrink-0 cursor-pointer rounded-md border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
            >
              {working ? 'Withdrawing…' : 'Withdraw'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div>
              <p className="text-sm font-medium text-ink">Delete account</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Permanently delete this account and all its data. This cannot be undone once the
                grace period ends.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="shrink-0 cursor-pointer rounded-md border border-critical px-4 py-2 text-sm font-medium text-critical transition-colors hover:bg-critical-wash"
            >
              Delete account
            </button>
          </div>
        )}
      </section>

      {/* Confirmation popout -- only reachable via the button above, never
          shown inline by default. */}
      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm account deletion"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-sm rounded-2xl border border-critical/40 bg-surface-raised p-6 shadow-lg"
          >
            <div className="flex items-center gap-2">
              <TriangleAlert size={18} strokeWidth={1.75} className="text-critical" aria-hidden />
              <h3 className="text-base font-semibold text-ink">Delete account</h3>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-secondary">
              Schedules the account for permanent deletion after a {DELETION_GRACE_DAYS}-day grace
              period. You can withdraw from Settings any time before then. After that, all
              collections, documents, and research history are permanently removed and the account
              is locked — it cannot be restored.
            </p>
            <label className="mt-4 block text-xs text-ink-secondary">
              Type <span className="font-mono font-semibold text-critical">DELETE</span> to confirm:
              <input
                type="text"
                autoFocus
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-critical focus:outline-none"
                placeholder="DELETE"
              />
            </label>
            {error && <p className="mt-2 text-xs text-critical">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={working}
                className="cursor-pointer rounded-md border border-hairline-strong px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-accent-wash disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={requestDeletion}
                disabled={confirmText !== 'DELETE' || working}
                className="cursor-pointer rounded-md bg-critical px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {working ? 'Scheduling…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
