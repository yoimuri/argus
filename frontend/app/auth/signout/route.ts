import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { type NextRequest } from 'next/server'

export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  // Clear the idle-tracking cookie on explicit logout too (proxy.ts), not just
  // on the idle-timeout's own redirect - otherwise a log-out-then-log-back-in
  // more than 30 minutes later inherits a stale timestamp and gets force-signed
  // out on its first authenticated request.
  const cookieStore = await cookies()
  cookieStore.delete('last_active')
  return redirect('/login')
}
