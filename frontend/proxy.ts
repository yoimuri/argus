import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          supabaseResponse = NextResponse.next({ request })
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

  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/auth')
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}