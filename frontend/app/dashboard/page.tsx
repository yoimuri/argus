import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import UploadPanel from './UploadPanel'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main style={{ maxWidth: 480, margin: '4rem auto' }}>
      <h1>Welcome, {user.email}</h1>
      <form action="/auth/signout" method="post">
        <button type="submit">Log out</button>
      </form>
      <UploadPanel />
    </main>
  )
}
