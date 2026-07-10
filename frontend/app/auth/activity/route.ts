import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

// Double-login structural fix (2026-07-10). The idle-timeout mechanism
// (proxy.ts) judges "idle" entirely from the last_active cookie, but nothing
// ever stamped that cookie AT LOGIN — it was only refreshed by later proxied
// requests and deleted on unauthenticated ones. Clint hit intermittent
// first-login "?reason=idle" bounces, meaning a stale timestamp sometimes
// survives into a brand-new session by a path we couldn't reliably reproduce
// (random per his testing). Rather than keep guessing at the leak, this makes
// the false positive structurally impossible: LoginForm calls this route the
// moment sign-in succeeds, so a fresh login always starts with a fresh
// activity timestamp regardless of what any older cookie said. Server-side
// because last_active is httpOnly (client JS can't write it).
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Same attributes as proxy.ts's own set of this cookie — the two must not
  // drift or the browser could hold duplicate cookies with different scopes.
  const cookieStore = await cookies()
  cookieStore.set('last_active', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return NextResponse.json({ ok: true })
}
