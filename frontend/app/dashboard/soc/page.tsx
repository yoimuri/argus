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
