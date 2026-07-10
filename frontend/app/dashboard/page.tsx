import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'

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

  const [collections, documents, sessions, latest] = await Promise.all([
    supabase.from('collections').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
    supabase.from('research_sessions').select('id', { count: 'exact', head: true }),
    supabase
      .from('research_sessions')
      .select('id,query,status,created_at')
      .order('created_at', { ascending: false })
      .limit(1),
  ])

  const counts = [
    { label: 'Collections', value: collections.count ?? 0, href: '/dashboard/workspace' },
    { label: 'Documents', value: documents.count ?? 0, href: '/dashboard/workspace' },
    { label: 'Research sessions', value: sessions.count ?? 0, href: '/dashboard/sessions' },
  ]
  const latestSession = latest.data?.[0] ?? null
  const isNew = (collections.count ?? 0) === 0

  const steps = [
    { text: 'Create a collection — a folder for related documents.', href: '/dashboard/workspace' },
    { text: 'Upload a PDF into it (previewed before it uploads).', href: '/dashboard/workspace' },
    { text: 'Ask a question — six AI agents retrieve, answer, and self-check.', href: '/dashboard/workspace' },
    { text: 'Open the session to replay every agent step and its timing.', href: '/dashboard/sessions' },
    { text: 'Watch the SOC page for blocked injection attempts and system health.', href: '/dashboard/soc' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Welcome, {displayName}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Upload a document, ask it questions, get cited answers — and see exactly how the
          system produced them.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {counts.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-lg border border-hairline bg-surface p-4 transition-colors hover:bg-accent-wash"
          >
            <p className="text-2xl font-semibold text-ink">{c.value}</p>
            <p className="mt-1 text-xs text-ink-muted">{c.label}</p>
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-hairline bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">
          {isNew ? 'Get started' : 'How it works'}
        </h2>
        <ol className="mt-3 space-y-2">
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
            className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
          >
            Get started →
          </Link>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Note: the backend sleeps when idle (free tier) — the first action after a quiet
          period can take 30–60 seconds to wake it up.
        </p>
      </section>

      {latestSession && (
        <section className="rounded-lg border border-hairline bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink">Latest research</h2>
          <Link
            href={`/dashboard/sessions/${latestSession.id}`}
            className="mt-2 flex items-center gap-3 text-sm text-ink-secondary transition-colors hover:text-ink"
          >
            <span className="min-w-0 flex-1 truncate">{latestSession.query}</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {new Date(latestSession.created_at).toLocaleString()}
            </span>
          </Link>
        </section>
      )}
    </div>
  )
}
