import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Eye } from 'lucide-react'
import ProfileMenu from '@/components/ProfileMenu'
import DashboardNav from '@/components/dashboard/DashboardNav'
import DeletionNotice from '@/components/settings/DeletionNotice'
import ChatWidget from '@/components/landing/ChatWidget'
import SessionKeepAlive from '@/components/auth/SessionKeepAlive'
import EyeNetworkBackground from '@/components/effects/EyeNetworkBackground'

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
    // `isolate`: guarantees the -z-10 canvas below paints above this shell's
    // backdrop but below all content, independent of body-background
    // propagation quirks (same stacking fix as the landing/login roots).
    <div className="isolate min-h-full flex flex-col">
      {/* The site's signature animated background, ambient tier (2026-07-15):
          "throughout the pages, not just the landing page" -- mounted ONCE
          here in the shared shell so it's a single instance for the whole
          authenticated app (Next.js keeps a shared layout mounted across
          client-side navigation between /dashboard/* routes, no remount per
          page). Fixed behind everything; page content sits on solid Card
          surfaces (shadow token added in the shell pass), so this never has
          to compete with text for contrast -- it only shows in the gaps. */}
      <EyeNetworkBackground intensity="ambient" className="fixed inset-0 -z-10 h-full w-full" />
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
          keep the nav chrome out of that printout.
          Sprint 4.7 shell fix: this header used to be a plain flat bar with no
          depth or blur, while the landing page (the supposed "design language
          source") had sticky+blur+a real wordmark lockup. Since this header is
          the one element present on EVERY dashboard page, that mismatch is why
          the whole app kept reading as "still basic" no matter what individual
          page bodies got -- the frame around the content never changed. Now
          mirrors the landing header's treatment exactly (sticky, blur, themed
          shadow token, icon+tracking wordmark). */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-surface/90 shadow-[var(--shadow-header)] backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-5 py-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm font-semibold tracking-[0.2em] text-ink transition-colors hover:text-accent"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-wash text-accent">
              <Eye size={15} strokeWidth={2} aria-hidden />
            </span>
            ARGUS
          </Link>
          <DashboardNav />
          <div className="ml-auto">
            <ProfileMenu email={user.email ?? 'unknown'} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8">{children}</main>
      {/* The project chatbot lives inside the dashboard too (Clint,
          2026-07-13): signed-in users can ask it how to navigate the app,
          not just what ARGUS is. Same public /chat backend, same rate
          limits -- the widget never sends the user's token. */}
      <ChatWidget />
    </div>
  )
}
