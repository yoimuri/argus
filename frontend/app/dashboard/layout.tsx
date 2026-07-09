import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ThemeToggle from '@/components/theme/ThemeToggle'

// D1: shared nav for every /dashboard/* route, hosts the auth check (dual-
// guard alongside proxy.ts -- see proxy.ts's own comment) so individual
// pages under here don't each repeat their own getUser() call.
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
          <span className="text-sm font-semibold tracking-wide text-ink">ARGUS</span>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
            >
              Workspace
            </Link>
            <Link
              href="/dashboard/sessions"
              className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
            >
              Sessions
            </Link>
            <Link
              href="/dashboard/soc"
              className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
            >
              SOC
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-ink-muted sm:inline">{user.email}</span>
            <ThemeToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md border border-hairline px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  )
}
