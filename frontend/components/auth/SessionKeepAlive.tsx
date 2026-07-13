'use client'

import { useEffect, useRef } from 'react'

// Session keep-alive (2026-07-14, fixes Clint's "logged out after 30 min even
// though I was actively using it"). proxy.ts's idle timeout judges "active"
// only by requests that pass through the Next.js server (a navigation or an API
// call) -- it re-stamps `last_active` on those. Reading a report, scrolling, or
// typing a question without submitting fires NO such request, so the timer goes
// stale and the next click bounces the user with ?reason=idle even though a
// human was clearly using the app the whole time.
//
// This closes that gap WITHOUT defeating the idle timeout's real purpose. It
// re-stamps `last_active` (via the existing httpOnly /auth/activity route) only
// when the user has genuinely interacted, and at most once per PING_INTERVAL. If
// the user walks away, interaction stops, pings stop, `last_active` ages
// normally, and the 30-minute logout still fires exactly as before. So: active
// = stays in; truly idle = still times out. A blind setInterval would have kept
// an abandoned tab logged in forever -- that's why this gates on real activity.
const CHECK_INTERVAL_MS = 60_000 // 1 min: how often we re-evaluate
const PING_INTERVAL_MS = 5 * 60_000 // 5 min: max one re-stamp per this window
                                    // (idle timeout is 30 min -- ample margin)

export default function SessionKeepAlive() {
  // Refs, not state: activity is high-frequency and must never trigger a
  // re-render (a mousemove-driven setState would thrash the whole subtree).
  const activeSinceLastPing = useRef(false)
  // Treat mount as a fresh stamp: login already POSTed /auth/activity, so the
  // first keep-alive ping is at most PING_INTERVAL_MS away, never immediate.
  const lastPing = useRef(Date.now())

  useEffect(() => {
    const markActive = () => {
      activeSinceLastPing.current = true
    }

    // Passive listeners: these never call preventDefault, so passive:true lets
    // the browser skip the can-this-block-scrolling check -- zero scroll jank.
    const events = ['mousemove', 'keydown', 'scroll', 'click', 'pointerdown', 'touchstart']
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }))

    const id = setInterval(() => {
      const now = Date.now()
      if (activeSinceLastPing.current && now - lastPing.current >= PING_INTERVAL_MS) {
        // Reset BEFORE the async call: if the user stops interacting right after
        // this ping, the next window sees no activity and lets the timer age.
        activeSinceLastPing.current = false
        lastPing.current = now
        // Same-origin, so cookies ride along; keepalive lets it complete even
        // if the tab is closing. Failures are non-fatal -- worst case the user
        // hits the normal idle timeout, which is the pre-fix behavior.
        fetch('/auth/activity', { method: 'POST', keepalive: true }).catch(() => {})
      }
    }, CHECK_INTERVAL_MS)

    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive))
      clearInterval(id)
    }
  }, [])

  return null
}
