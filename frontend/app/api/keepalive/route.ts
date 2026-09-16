import { NextResponse, type NextRequest } from 'next/server'

// Keeps the Supabase project from being paused (2026-09-16).
//
// THE PROBLEM THIS SOLVES. Supabase's Free plan pauses a project after 7
// consecutive days with no database activity, and a paused project takes the
// whole app down until someone restores it by hand in the dashboard. Only real
// queries count — opening the dashboard does not. ARGUS is a portfolio piece
// that has to survive weeks of nobody touching it, so without this it goes dark
// on a timer, and the most likely person to discover that is a recruiter.
//
// WHY VERCEL CRON AND NOT GITHUB ACTIONS. GitHub Actions is the usual answer and
// it is the wrong one here: in a public repository GitHub automatically disables
// scheduled workflows after 60 days with no repository activity. That is
// precisely the scenario being defended against — the schedule would switch
// itself off during a quiet stretch, and the database would pause a week later,
// silently. Vercel's cron has no inactivity rule; it runs for as long as the
// project is deployed. Hobby allows one run per day, which is seven times more
// often than the 7-day window needs.
//
// WHAT IT DELIBERATELY DOES NOT DO: ping the Render backend. Render's free tier
// bills 750 instance-hours per month and a calendar month is ~730 hours, so
// keeping the backend awake would consume nearly the entire monthly allowance
// and risk suspending it — the opposite of the goal. Render spinning down when
// idle is the behaviour you want on that plan; the 50-second cold start is the
// price. Only Supabase has the pause problem, so only Supabase gets pinged.
//
// `force-dynamic` is belt and braces. Route Handlers are not cached by default
// in this Next version, but a GET handler CAN become prerendered if Cache
// Components is ever switched on — and a prerendered keepalive would return 200
// forever while never touching the database. That failure would be completely
// silent, which is the category of bug this project keeps getting bitten by, so
// it is ruled out explicitly rather than left to a default.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations
  // when that environment variable is set. Verify it so this is not a free
  // unauthenticated route anyone can hammer. If CRON_SECRET is not configured
  // the check is skipped, which keeps the endpoint working before the variable
  // is added — the route is harmless either way (it reads nothing and writes
  // nothing), so failing open here costs nothing and avoids a confusing 401 on
  // first deploy.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: 'Supabase env vars missing' },
      { status: 500 },
    )
  }

  try {
    // Calls public.keepalive() (migration 026): SECURITY INVOKER, reads no
    // table, returns a timestamp. The point is not the answer, it is that a
    // query ran inside Postgres — that is what resets the pause timer.
    const res = await fetch(`${url}/rest/v1/rpc/keepalive`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    })

    const body = await res.text()
    if (!res.ok) {
      // Logged loudly and returned as a non-200 so a broken keepalive shows up
      // in Vercel's cron history instead of quietly succeeding for weeks while
      // the pause timer keeps counting down.
      console.error(`[ARGUS] keepalive failed ${res.status}: ${body.slice(0, 200)}`)
      return NextResponse.json(
        { ok: false, status: res.status, detail: body.slice(0, 200) },
        { status: 502 },
      )
    }

    return NextResponse.json({ ok: true, db: body.slice(0, 80) })
  } catch (err) {
    console.error('[ARGUS] keepalive error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 })
  }
}
