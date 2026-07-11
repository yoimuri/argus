import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/utils/supabase/server'

// Google OAuth callback (Sprint 4.4, D13). @supabase/ssr uses the PKCE flow by
// default: signInWithOAuth (LoginForm) redirects the browser to Google, Google
// redirects back HERE with an Auth Code in ?code=, and we exchange that code
// for a session which gets written into the auth cookies. This route is a
// public path (proxy.ts's isPublicPath covers everything under /auth) so an
// as-yet-unauthenticated visitor can complete the exchange.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // Only ever redirect to a same-origin relative path. `^/[^/\\]` rejects
  // protocol-relative (`//evil.com`) and backslash (`/\evil.com`) tricks that
  // would otherwise turn ?next= into an open redirect off our own domain.
  const nextParam = searchParams.get('next')
  const next = nextParam && /^\/[^/\\]/.test(nextParam) ? nextParam : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  // Stamp last_active NOW, exactly as the password path does via /auth/activity,
  // so an OAuth login is equally immune to the stale-cookie "?reason=idle on
  // first login" bug. Same cookie attributes as proxy.ts to prevent drift.
  const cookieStore = await cookies()
  cookieStore.set('last_active', String(Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  // Behind Vercel the user-facing host is in x-forwarded-host; `origin` can be
  // the internal address. Trust the forwarded host in production, `origin`
  // locally. (Documented Supabase Next.js callback pattern.)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocalEnv = process.env.NODE_ENV === 'development'
  const base = isLocalEnv ? origin : forwardedHost ? `https://${forwardedHost}` : origin
  return NextResponse.redirect(`${base}${next}`)
}
