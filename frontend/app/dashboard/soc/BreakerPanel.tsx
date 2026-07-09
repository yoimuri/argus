'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiJson } from '@/utils/api'

interface BreakerSnapshot {
  state: 'closed' | 'half_open' | 'open'
  recent_failures: number
  fail_threshold: number
  seconds_since_opened: number | null
}

interface LangfuseSnapshot {
  enabled: boolean
  disabled: boolean
}

interface BreakerHealth {
  groq: BreakerSnapshot
  hf_prompt_guard: BreakerSnapshot
  hf_embedding: BreakerSnapshot
  tavily: BreakerSnapshot
  langfuse: LangfuseSnapshot
}

const POLL_MS = 20_000

const BREAKER_LABELS: Record<keyof Omit<BreakerHealth, 'langfuse'>, string> = {
  groq: 'Groq (LLM inference)',
  hf_prompt_guard: 'HF prompt-injection guard',
  hf_embedding: 'HF embeddings',
  tavily: 'Tavily (web search)',
}

// Status palette computed via the dataviz skill's validator (docs/PHASE4.md
// Sprint 4.2), not eyeballed -- same fixed hexes across light/dark since
// status colors never follow the theme.
const STATE_STYLE: Record<BreakerSnapshot['state'], { dot: string; wash: string; label: string }> = {
  closed: { dot: 'bg-good', wash: 'bg-good-wash', label: 'Closed' },
  half_open: { dot: 'bg-warning', wash: 'bg-warning-wash', label: 'Half-open' },
  open: { dot: 'bg-critical', wash: 'bg-critical-wash', label: 'Open' },
}

function BreakerCard({ name, snapshot }: { name: string; snapshot: BreakerSnapshot }) {
  const style = STATE_STYLE[snapshot.state]
  return (
    <div className={`rounded-lg border border-hairline p-3 ${style.wash}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden />
        <span className="text-sm font-medium text-ink">{name}</span>
        <span className="ml-auto text-xs font-semibold text-ink-secondary">{style.label}</span>
      </div>
      <dl className="mt-2 flex gap-4 text-xs text-ink-muted">
        <div>
          <dt className="inline">Failures: </dt>
          <dd className="inline font-mono text-ink-secondary">
            {snapshot.recent_failures}/{snapshot.fail_threshold}
          </dd>
        </div>
        {snapshot.seconds_since_opened !== null && (
          <div>
            <dt className="inline">Opened: </dt>
            <dd className="inline font-mono text-ink-secondary">{snapshot.seconds_since_opened}s ago</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

export default function BreakerPanel() {
  const [health, setHealth] = useState<BreakerHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      // /status/breakers, NOT /health/*: EasyPrivacy's `||onrender.com/health`
      // rule (default-on in Brave, uBlock Origin, etc.) silently blocks any
      // browser fetch to /health* on Render-hosted apps (found live 2026-07-09).
      const data = await apiJson<BreakerHealth>('/status/breakers')
      setHealth(data)
      setError(null)
    } catch (err) {
      // Render the failure -- a broken breaker panel must be visible, not
      // silently stuck on stale data (same principle the events feed below
      // follows for its subscription state).
      setError(err instanceof Error ? err.message : 'Could not load breaker health.')
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, POLL_MS)
    const onFocus = () => fetchHealth()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchHealth])

  if (error && !health) {
    return (
      <div className="rounded-lg border border-critical bg-critical-wash p-3 text-sm text-ink">
        Breaker health unavailable: {error}
      </div>
    )
  }

  if (!health) {
    return <p className="text-sm text-ink-muted">Loading breaker health...</p>
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.keys(BREAKER_LABELS) as (keyof typeof BREAKER_LABELS)[]).map((key) => (
          <BreakerCard key={key} name={BREAKER_LABELS[key]} snapshot={health[key]} />
        ))}
      </div>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 text-xs text-ink-secondary">
        <span
          className={`h-2 w-2 rounded-full ${health.langfuse.enabled ? 'bg-good' : 'bg-ink-muted'}`}
          aria-hidden
        />
        Langfuse tracing {health.langfuse.enabled ? 'enabled' : 'disabled'}
      </div>
      {error && (
        <p className="mt-2 text-xs text-critical">Last refresh failed ({error}) -- showing previous data.</p>
      )}
    </div>
  )
}
