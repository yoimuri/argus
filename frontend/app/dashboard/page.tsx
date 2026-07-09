import { createClient } from '@/utils/supabase/server'
import UploadPanel from './UploadPanel'

// Auth is already guarded by dashboard/layout.tsx (dual-guard alongside
// proxy.ts) -- this page only needs the user for the greeting.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Welcome, {user?.email}</h1>
      <UploadPanel />
    </div>
  )
}
