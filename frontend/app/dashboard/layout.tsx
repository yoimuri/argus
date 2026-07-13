import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProfileMenu from '@/components/ProfileMenu'
import DashboardNav from '@/components/dashboard/DashboardNav'
import DeletionNotice from '@/components/settings/DeletionNotice'
import ChatWidget from '@/components/landing/ChatWidget'
import SessionKeepAlive from '@/components/auth/SessionKeepAlive'

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
      {/* Keeps the session alive while the user is genuinely interacting, so a
          long read/scroll without a navigation no longer trips the 30-min idle
          logout (proxy.ts). Renders nothing. */}
      <SessionKeepAlive />
      {(profile?.deletion_requested_at || profile?.account_deleted_at) && (
        <DeletionNotice
          requestedAt={profile?.deletion_requested_at ?? null}
          accountDeletedAt={profile?.account_deleted_at ?? null}
        />
      )}
      {/* print:hidden: there's no in-app PDF export (the .docx is the
          deliverable), but a user can still browser-print (Ctrl+P) a report --
          keep the nav chrome out of that printout. */}
      <header className="border-b border-hairline bg-surface print:hidden">
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
      {/* The project chatbot lives inside the dashboard too (Clint,
          2026-07-13): signed-in users can ask it how to navigate the app,
          not just what ARGUS is. Same public /chat backend, same rate
          limits -- the widget never sends the user's token. */}
      <ChatWidget />
    </div>
  )
}
