import { createClient } from '@/utils/supabase/server'
import UploadPanel from './UploadPanel'

// Auth is already guarded by dashboard/layout.tsx (dual-guard alongside
// proxy.ts) -- this page only needs the user for the greeting.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Prefer a real name when one exists. Password accounts (test@/test2@) have
  // no name in metadata, so this falls back to email today; Google OAuth
  // (Sprint 4.4) populates full_name/name, at which point the greeting shows
  // the person's name with no further change here. (Future suggestion #1.)
  const displayName =
    user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email

  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Welcome, {displayName}</h1>
      <UploadPanel />
    </div>
  )
}
