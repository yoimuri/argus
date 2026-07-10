import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export async function proxy(request: NextRequest) {
  // Nonce-based CSP (ADR-008 addendum, closes pentest finding HDR_003: static
  // 'unsafe-inline' on script-src disables XSS protection). A fresh,
  // unpredictable value per request, allow-listed via 'nonce-{value}' instead
  // of 'unsafe-inline'. Next.js parses this header during SSR and auto-applies
  // the nonce to its own framework scripts and page bundles — no per-component
  // changes needed. style-src keeps 'unsafe-inline' deliberately: components
  // use inline style={{}} throughout, and nonces don't apply to style
  // attributes anyway, so nonce-ing styles would break the UI for no security
  // gain (styles can't execute JS).
  //
  // frame-src 'self' blob: — the upload PDF preview (Sprint 4.3, decision #11)
  // renders the locally-chosen file in an <iframe src="blob:...">. Without a
  // frame-src entry it falls back to default-src 'self', which excludes blob:,
  // so the preview silently rendered nothing (live-found 2026-07-10). object-src
  // stays 'none' — an <iframe> is governed by frame-src, so the preview works
  // without weakening the plugin/Flash hardening that object-src 'none' gives.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  // Realtime (Sprint 4.2, D9) connects over a websocket to the same Supabase
  // project, not plain https -- scheme-matching a wss:// connection under an
  // https:// connect-src source is inconsistent across browsers, so it needs
  // its own explicit entry rather than relying on the https one to cover it.
  const supabaseWsUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https:/, 'wss:')
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data:;
    font-src 'self';
    connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL} ${supabaseWsUrl} ${process.env.NEXT_PUBLIC_API_URL};
    object-src 'none';
    frame-src 'self' blob:;
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `
    .replace(/\s{2,}/g, ' ')
    .trim()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', cspHeader)

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
  supabaseResponse.headers.set('Content-Security-Policy', cspHeader)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
          supabaseResponse.headers.set('Content-Security-Policy', cspHeader)
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Any unauthenticated request is a good place to drop a stale
    // last_active left over from a prior session. The July 8 fix only
    // cleared this in the redirect branch below (a protected page bouncing
    // an unauthenticated visitor to /login) -- it missed the case where the
    // browser lands on /login or /auth directly (typed URL, bookmark, a
    // client-side redirect after a 401), which never passes through that
    // branch at all. In that missed case the stale cookie survives the next
    // login, and the very first authenticated request afterward sees it's
    // >30 min old and force-signs the brand-new session back out -- the same
    // "works on attempt two, not one" bug, reached by a different route than
    // the one already fixed. Found live 2026-07-09.
    supabaseResponse.cookies.delete('last_active')

    if (
      !request.nextUrl.pathname.startsWith('/login') &&
      !request.nextUrl.pathname.startsWith('/auth')
    ) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirectResponse = NextResponse.redirect(url)
      redirectResponse.headers.set('Content-Security-Policy', cspHeader)
      redirectResponse.cookies.delete('last_active')
      return redirectResponse
    }
  }

  // Idle timeout, checked on whatever the next request happens to be, not a
  // live countdown, nothing fires while a tab just sits open with no new
  // request. If the last recorded activity is older than 30 minutes, sign
  // out and send to login. scope: 'local' matters here, this only ends the
  // session on this browser, not every device the user happens to be logged
  // into. See docs/ADR-009.md.
  if (
    user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth')
  ) {
    const lastActive = request.cookies.get('last_active')?.value
    const now = Date.now()

    if (lastActive && now - Number(lastActive) > IDLE_TIMEOUT_MS) {
      await supabase.auth.signOut({ scope: 'local' })
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('reason', 'idle')
      // signOut() cleared the auth cookies by writing to supabaseResponse, but
      // we're about to return a *different* response object. Copy those cookie
      // mutations onto the redirect, otherwise the browser keeps its session
      // cookies and the "logout" never actually happens client-side.
      const redirectResponse = NextResponse.redirect(url)
      redirectResponse.headers.set('Content-Security-Policy', cspHeader)
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie)
      })
      redirectResponse.cookies.delete('last_active')
      return redirectResponse
    }

    supabaseResponse.cookies.set('last_active', String(now), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      // Without maxAge this was a session cookie: closing the browser deleted
      // it, so returning after any gap looked like a fresh visit and the idle
      // timer never fired. Persisting it is what makes "left the site, came
      // back 40 minutes later" actually require a re-login.
      maxAge: 60 * 60 * 24 * 7,
    })
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - image assets
     * and skip prefetch requests (next/link) so they don't churn nonces.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
