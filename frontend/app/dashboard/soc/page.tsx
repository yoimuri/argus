import BreakerPanel from './BreakerPanel'
import SecurityEventsFeed from './SecurityEventsFeed'

// Auth already guarded by dashboard/layout.tsx. Read-only, per-user dashboard
// only (no admin role, no cross-user data) -- see docs/ADR-018.md Part 3 for
// why the rest of the original SOC sketch (world map, global feed, IP intel)
// is Phase 4b, not here.
export default function SocPage() {
  return (
    <div className="soc-dense space-y-6">
      <div>
        <h1 className="text-base font-semibold text-ink">SOC</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Live breaker health and your own security events. Per-account view only.
        </p>
      </div>

      {/* Plain-words explainer (Clint's feedback, 2026-07-10): normal users
          shouldn't need to know what a "SOC" is to understand this page. */}
      <section className="rounded-lg border border-hairline bg-surface p-4 text-sm text-ink-secondary">
        <h2 className="text-sm font-semibold text-ink">What is this page?</h2>
        <p className="mt-2">
          SOC stands for Security Operations Center, in a real company the room where people
          watch systems for attacks and outages. This is your personal version of that view,
          because transparency is part of ARGUS&apos;s design: you get to see the system defending
          your own data, not just trust that it does.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-ink">Circuit breakers</span> show the health of the
            AI services ARGUS depends on. Green means healthy; if one trips (red), ARGUS degrades
            gracefully instead of crashing, and recovers on its own.
          </li>
          <li>
            <span className="font-medium text-ink">Security events</span> list moments the system
            blocked something suspicious in <em>your</em> account, like a prompt-injection attempt
            hidden in a document or typed into the question box. Seeing entries here is the defense
            working, not something being wrong.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Circuit breakers</h2>
        <BreakerPanel />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Security events</h2>
        <SecurityEventsFeed />
      </section>
    </div>
  )
}
