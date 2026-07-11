import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ProfileMenu from '@/components/ProfileMenu'
import DashboardNav from '@/components/dashboard/DashboardNav'

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

  return (
    <div className="min-h-full flex flex-col">
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
