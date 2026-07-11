import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import ThemeToggle from '@/components/theme/ThemeToggle'
import { buttonClasses } from '@/components/ui/Button'
import { User, Palette, Gauge, ShieldCheck, LogOut } from 'lucide-react'

// Real Settings page (presentability pass, 2026-07-11) -- replaces the disabled
// "coming soon" stub in ProfileMenu. Server component: reads the user + their
// usage caps directly (RLS-scoped), with the theme toggle as a client island.
// Honest by design: it only offers what actually exists. There is no "delete
// account" button because account-level deletion isn't built (per-collection
// erasure is, in the Workspace) -- the Data section says so plainly rather than
// showing a control that does nothing.
export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: limits } = await supabase
    .from('usage_limits')
    .select('max_collections,max_documents,max_research_per_day')
    .maybeSingle()

  const displayName =
    user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? '—'
  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—'

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your account, appearance, and free-tier limits.
        </p>
      </div>

      {/* Account */}
      <section className="rounded-lg border border-hairline bg-surface">
        <SectionHeader icon={<User size={16} strokeWidth={1.75} aria-hidden />} title="Account" />
        <dl className="divide-y divide-hairline">
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Name" value={displayName} />
          <Row label="Member since" value={memberSince} />
        </dl>
      </section>

      {/* Appearance */}
      <section className="rounded-lg border border-hairline bg-surface">
        <SectionHeader icon={<Palette size={16} strokeWidth={1.75} aria-hidden />} title="Appearance" />
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm text-ink">Theme</p>
            <p className="text-xs text-ink-muted">Light, dark, or match your system.</p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      {/* Usage & limits */}
      <section className="rounded-lg border border-hairline bg-surface">
        <SectionHeader icon={<Gauge size={16} strokeWidth={1.75} aria-hidden />} title="Free-tier limits" />
        <dl className="divide-y divide-hairline">
          <Row label="Collections" value={String(limits?.max_collections ?? 3)} />
          <Row label="Documents" value={String(limits?.max_documents ?? 15)} />
          <Row label="Research queries / day" value={String(limits?.max_research_per_day ?? 15)} />
        </dl>
        <p className="px-4 pb-3 pt-1 text-xs text-ink-muted">
          These are free-tier limits. Live usage is on the{' '}
          <Link href="/dashboard" className="text-accent hover:underline">
            dashboard
          </Link>
          . Reach out if you need them raised.
        </p>
      </section>

      {/* Data & privacy */}
      <section className="rounded-lg border border-hairline bg-surface">
        <SectionHeader
          icon={<ShieldCheck size={16} strokeWidth={1.75} aria-hidden />}
          title="Data & privacy"
        />
        <div className="space-y-3 px-4 py-3 text-sm text-ink-secondary">
          <p>
            To remove your data, delete a collection in the{' '}
            <Link href="/dashboard/workspace" className="text-accent hover:underline">
              Workspace
            </Link>
            . That permanently removes its documents, their embedded chunks, and the stored files.
          </p>
          <p className="text-xs text-ink-muted">
            Full one-click account deletion isn&apos;t available yet. How ARGUS handles your data is
            documented in its{' '}
            <a
              href="https://github.com/yoimuri/argus/blob/main/docs/ADR-013.md"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              privacy posture ↗
            </a>
            .
          </p>
        </div>
      </section>

      {/* Sign out */}
      <form action="/auth/signout" method="post">
        <button type="submit" className={buttonClasses('danger', 'md', 'w-full sm:w-auto')}>
          <LogOut size={16} strokeWidth={1.75} aria-hidden />
          Log out
        </button>
      </form>
    </div>
  )
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
      <span className="text-ink-muted">{icon}</span>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-sm text-ink" title={value}>
        {value}
      </dd>
    </div>
  )
}
