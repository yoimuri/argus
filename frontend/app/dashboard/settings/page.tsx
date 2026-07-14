import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import ThemeToggle from '@/components/theme/ThemeToggle'
import DangerZone from '@/components/settings/DangerZone'
import { buttonClasses } from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
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

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ data: limits }, collections, documents, researchToday, reportsToday, { data: profile }] =
    await Promise.all([
      supabase
        .from('usage_limits')
        .select('max_collections,max_documents,max_research_per_day,max_reports_per_day')
        .maybeSingle(),
      supabase.from('collections').select('id', { count: 'exact', head: true }),
      supabase.from('documents').select('id', { count: 'exact', head: true }),
      supabase
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'research')
        .gte('created_at', since),
      // Report generations (Sprint 4.6a) meter through usage_events too.
      supabase
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'report')
        .gte('created_at', since),
      supabase.from('user_profiles').select('deletion_requested_at').maybeSingle(),
    ])

  const meters = [
    { label: 'Collections', used: collections.count ?? 0, max: limits?.max_collections ?? 3 },
    { label: 'Documents', used: documents.count ?? 0, max: limits?.max_documents ?? 15 },
    {
      label: 'Research queries (last 24h)',
      used: researchToday.count ?? 0,
      max: limits?.max_research_per_day ?? 15,
    },
    {
      label: 'Generated reports (last 24h)',
      used: reportsToday.count ?? 0,
      max: limits?.max_reports_per_day ?? 3,
    },
  ]

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
    <div className="rise mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" subtitle="Your account, appearance, and free-tier limits." />


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

      {/* Usage & limits: bars with % (Clint, 2026-07-11), same amber-at-80% /
          red-at-cap convention as the dashboard meters. */}
      <section className="rounded-lg border border-hairline bg-surface">
        <SectionHeader icon={<Gauge size={16} strokeWidth={1.75} aria-hidden />} title="Free-tier usage" />
        <div className="space-y-4 px-4 py-3">
          {meters.map((m) => {
            const pct = m.max > 0 ? Math.min(100, Math.round((m.used / m.max) * 100)) : 0
            const atLimit = m.used >= m.max
            const near = !atLimit && pct >= 80
            const barColor = atLimit
              ? 'var(--color-critical)'
              : near
                ? 'var(--color-warning)'
                : 'var(--color-accent)'
            return (
              <div key={m.label}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-secondary">{m.label}</span>
                  <span className={atLimit ? 'font-medium text-critical' : 'text-ink-muted'}>
                    {m.used} / {m.max} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-hairline">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <p className="px-4 pb-3 pt-1 text-xs text-ink-muted">
          These are free-tier limits. Reach out via{' '}
          <Link href="/dashboard/support" className="text-accent hover:underline">
            Support
          </Link>{' '}
          if you need them raised.
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

      {/* Danger zone: account deletion with 7-day grace (ADR-020) */}
      <DangerZone initialRequestedAt={profile?.deletion_requested_at ?? null} />

      {/* Sign out sits at the very bottom (Clint, 2026-07-11) -- routine exit
          below the destructive zone, matching the GitHub settings layout. */}
      <form action="/auth/signout" method="post" className="border-t border-hairline pt-6">
        <button type="submit" className={buttonClasses('secondary', 'md', 'w-full sm:w-auto')}>
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
