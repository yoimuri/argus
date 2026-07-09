'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

interface SecurityEvent {
  id: string
  user_id: string | null
  event_type: string
  source: string | null
  detail: string | null
  created_at: string
}

type SubState = 'connecting' | 'subscribed' | 'error' | 'closed'

const INITIAL_LIMIT = 50

const SUB_STATE_STYLE: Record<SubState, { dot: string; label: string }> = {
  connecting: { dot: 'bg-ink-muted', label: 'Connecting...' },
  subscribed: { dot: 'bg-good', label: 'Live' },
  error: { dot: 'bg-critical', label: 'Reconnecting' },
  closed: { dot: 'bg-warning', label: 'Disconnected' },
}

export default function SecurityEventsFeed() {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [subState, setSubState] = useState<SubState>('connecting')
  const supabaseRef = useRef(createClient())

  useEffect(() => {
    const supabase = supabaseRef.current
    let ignore = false
    let channel: RealtimeChannel | null = null

    async function init() {
      // Initial page. RLS ("own security events", migration 004) scopes this
      // to the caller's own rows regardless of the query -- no extra
      // user_id filter needed for a direct Supabase read like this one.
      const { data, error } = await supabase
        .from('security_events')
        .select('id,user_id,event_type,source,detail,created_at')
        .order('created_at', { ascending: false })
        .limit(INITIAL_LIMIT)

      if (ignore) return
      if (error) setLoadError(error.message)
      else setEvents(data ?? [])
      setLoading(false)

      // Realtime evaluates RLS per-subscriber using this token (migration
      // 009 publishes the table; the SELECT policy is what actually scopes
      // each socket to its own rows -- see docs/ADR-018.md-successor notes
      // in docs/PHASE4.md for the D8 design).
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (ignore) return
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)

      channel = supabase
        .channel('security_events_feed')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'security_events' },
          (payload) => {
            setEvents((prev) => [payload.new as SecurityEvent, ...prev].slice(0, INITIAL_LIMIT))
          },
        )
        .subscribe((status) => {
          if (ignore) return
          if (status === 'SUBSCRIBED') setSubState('subscribed')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSubState('error')
          else if (status === 'CLOSED') setSubState('closed')
        })
    }

    init()

    return () => {
      ignore = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  const subStyle = SUB_STATE_STYLE[subState]

  return (
    <div>
      <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-hairline px-3 py-1 text-xs text-ink-secondary">
        <span className={`h-2 w-2 rounded-full ${subStyle.dot}`} aria-hidden />
        {subStyle.label}
      </div>

      {loading && <p className="text-sm text-ink-muted">Loading security events...</p>}
      {loadError && (
        <p className="text-sm text-critical">Could not load events: {loadError}</p>
      )}
      {!loading && !loadError && events.length === 0 && (
        <p className="text-sm text-ink-muted">No security events yet for this account.</p>
      )}

      {events.length > 0 && (
        <ul className="divide-y divide-hairline rounded-lg border border-hairline">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 p-3 text-sm">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-ink">{event.event_type}</span>
                  {event.source && (
                    <span className="font-mono text-xs text-ink-muted">{event.source}</span>
                  )}
                  <span className="ml-auto text-xs text-ink-muted">
                    {new Date(event.created_at).toLocaleString()}
                  </span>
                </div>
                {event.detail && (
                  <p className="mt-1 truncate text-xs text-ink-secondary" title={event.detail}>
                    {event.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
