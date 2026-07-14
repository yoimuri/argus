import Link from 'next/link'
import { FolderKanban, FileText, History, ArrowRight, type LucideIcon } from 'lucide-react'
import { createClient } from '@/utils/supabase/server'
import PageHeader from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'

// The overview Clint asked for (2026-07-10): a real dashboard landing --
// what you have, what to do next -- instead of dropping users straight into
// the workspace form. Counts are read directly via the Supabase server
// client: RLS scopes every query to the signed-in user, so this needs no
// backend round-trip (and no Render cold-start hit on first paint).
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const displayName =
    user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email

  // Rolling-24h window for the daily research meter, matched to the backend's
  // enforcement (main.py counts research_sessions with created_at >= now-1d).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [collections, documents, sessions, latest, researchToday, limitsRow] =
    await Promise.all([
      supabase.from('collections').select('id', { count: 'exact', head: true }),
      supabase.from('documents').select('id', { count: 'exact', head: true }),
      supabase.from('research_sessions').select('id', { count: 'exact', head: true }),
      supabase
        .from('research_sessions')
        .select('id,query,status,created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      // usage_events, not research_sessions: the cap counts usage_events (they
      // survive collection deletion, migration 014), so the meter must too or
      // it would disagree with the backend after a delete.
      supabase
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'research')
        .gte('created_at', since),
      // RLS scopes this to the caller's own row (migration 011). SELECT-only
      // grant means the user can read but never raise their own caps.
      supabase
        .from('usage_limits')
        .select('max_collections,max_documents,max_research_per_day')
        .maybeSingle(),
    ])

  // Fall back to the tight defaults (same as the backend) if no row exists yet.
  const limits = limitsRow.data ?? {
    max_collections: 3,
    max_documents: 15,
    max_research_per_day: 15,
  }
  const meters = [
    { label: 'Collections', used: collections.count ?? 0, max: limits.max_collections },
    { label: 'Documents', used: documents.count ?? 0, max: limits.max_documents },
    { label: 'Research today', used: researchToday.count ?? 0, max: limits.max_research_per_day },
  ]

  const counts: { label: string; value: number; href: string; icon: LucideIcon }[] = [
    { label: 'Collections', value: collections.count ?? 0, href: '/dashboard/workspace', icon: FolderKanban },
    { label: 'Documents', value: documents.count ?? 0, href: '/dashboard/workspace', icon: FileText },
    { label: 'Research sessions', value: sessions.count ?? 0, href: '/dashboard/sessions', icon: History },
  ]
  const latestSession = latest.data?.[0] ?? null
  const isNew = (collections.count ?? 0) === 0

  const steps = [
    { text: 'Create a collection, a folder for related documents.', href: '/dashboard/workspace' },
    { text: 'Upload a PDF into it (previewed before it uploads).', href: '/dashboard/workspace' },
    { text: 'Ask a question. Six AI agents retrieve, answer, and self-check.', href: '/dashboard/workspace' },
    { text: 'Open the session to replay every agent step and its timing.', href: '/dashboard/sessions' },
    { text: 'Watch the SOC page for blocked injection attempts and system health.', href: '/dashboard/soc' },
  ]

  return (
    <div className="rise space-y-6">
      <PageHeader
        title={`Welcome, ${displayName}`}
        subtitle="Upload a document, ask it questions, get cited answers, and see exactly how the system produced them."
      />

      <div className="rise-group grid grid-cols-1 gap-3 sm:grid-cols-3">
        {counts.map((c) => {
          const Icon = c.icon
          return (
            <Link key={c.label} href={c.href} className="group">
              <Card interactive className="flex items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent transition-colors group-hover:bg-accent-wash-strong">
                  <Icon size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xl font-semibold tabular-nums leading-none text-ink">
                    {c.value}
                  </span>
                  <span className="mt-1 block truncate text-xs text-ink-muted">{c.label}</span>
                </span>
              </Card>
            </Link>
          )
        })}
      </div>

      <Card padded={false}>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-sm font-semibold text-ink">Free-tier usage</h2>
          <span className="text-xs text-ink-muted">rolling, per 24h for research</span>
        </div>
        <div className="mt-4 space-y-3 px-5 pb-4">
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
                  <span className={'tabular-nums ' + (atLimit ? 'font-medium text-critical' : 'text-ink-muted')}>
                    {m.used} / {m.max}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-hairline">
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                </div>
              </div>
            )
          })}
        </div>
        <p className="border-t border-hairline px-5 py-3 text-xs text-ink-muted">
          These are free-tier limits. Reach out if you need them raised.
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink">
          {isNew ? 'Get started' : 'How it works'}
        </h2>
        <ol className="mt-4 space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <Link href={s.href} className="text-ink-secondary transition-colors hover:text-ink">
                {s.text}
              </Link>
            </li>
          ))}
        </ol>
        {isNew && (
          <Link
            href="/dashboard/workspace"
            className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Get started <ArrowRight size={15} strokeWidth={2} aria-hidden />
          </Link>
        )}
        <p className="mt-4 text-xs text-ink-muted">
          Note: the backend sleeps when idle (free tier), so the first action after a quiet
          period can take 30 to 60 seconds to wake it up.
        </p>
      </Card>

      {latestSession && (
        <Card>
          <h2 className="text-sm font-semibold text-ink">Latest research</h2>
          <Link
            href={`/dashboard/sessions/${latestSession.id}`}
            className="mt-3 flex items-center gap-3 text-sm text-ink-secondary transition-colors hover:text-ink"
          >
            <span className="min-w-0 flex-1 truncate">{latestSession.query}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {new Date(latestSession.created_at).toLocaleString()}
            </span>
          </Link>
        </Card>
      )}
    </div>
  )
}
