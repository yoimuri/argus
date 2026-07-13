import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

// Must match proxy.ts's IDLE_TIMEOUT_MS.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

// Truthful auth state for the public landing CTA (#1, 2026-07-14). The landing
// button chose "Go to dashboard" vs "Sign in" from Supabase's own getSession(),
// which stays valid even after OUR 30-minute idle rule (proxy.ts) has expired
// the session -- so an idle-timed-out visitor saw "Go to dashboard" and then
// got bounced to /login on click. This route answers the SAME question the
// dashboard proxy will: authed only if Supabase still has a user AND
// last_active is within the idle window. last_active is httpOnly, so only the
// server can read it; the client asks here (see AuthLink.tsx). Read-only: unlike
// /auth/activity this never re-stamps the timer, so polling it can't keep a
// walked-away session alive.
export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ authed: false })
  }

  // Mirror proxy.ts exactly: an ABSENT last_active is treated as active (the
  // proxy skips the idle check and stamps a fresh one), so only a present,
  // stale timestamp counts as idle-expired.
  const lastActive = (await cookies()).get('last_active')?.value
  const idleExpired = Boolean(lastActive) && Date.now() - Number(lastActive) > IDLE_TIMEOUT_MS
  return NextResponse.json({ authed: !idleExpired })
}
