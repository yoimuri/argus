import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProfileMenu from '@/components/ProfileMenu'
import DashboardNav from '@/components/dashboard/DashboardNav'
import DeletionNotice from '@/components/settings/DeletionNotice'

// D1: shared nav for every /dashboard/* route, hosts the auth check (dual-
// guard alongside proxy.ts -- see proxy.ts's own comment) so individual
// pages under here don't each repeat their own getUser() call.
// 2026-07-10 shell rework (Clint's feedback): ARGUS wordmark is a link home,
// Workspace is its own tab (the old /dashboard now holds the overview), and
// the theme toggle + logout moved into the ProfileMenu dropdown.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Account-deletion state (ADR-020): read once per page render. A pending
  // request shows a withdrawal banner on every dashboard page; an expired one
  // makes DeletionNotice finalize (purge + sign-out) before anything else.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('deletion_requested_at,account_deleted_at')
    .maybeSingle()

  return (
    <div className="min-h-full flex flex-col">
      {(profile?.deletion_requested_at || profile?.account_deleted_at) && (
        <DeletionNotice
          requestedAt={profile?.deletion_requested_at ?? null}
          accountDeletedAt={profile?.account_deleted_at ?? null}
        />
      )}
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link
            href="/dashboard"
            className="text-sm font-semibold tracking-wide text-ink transition-colors hover:text-accent"
          >
            ARGUS
          </Link>
          <DashboardNav />
          <div className="ml-auto">
            <ProfileMenu email={user.email ?? 'unknown'} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
