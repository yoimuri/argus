import SessionList from './SessionList'
import PageHeader from '@/components/ui/PageHeader'

// Auth already guarded by dashboard/layout.tsx. D1: deep-linkable session
// URLs are the point of the Debug Diary -- a real route, not a tab.
export default function SessionsPage() {
  return (
    <div className="rise space-y-6">
      <PageHeader
        title="Sessions"
        subtitle="Your past research runs. Open one to see the step-by-step execution trace."
      />
      <SessionList />
    </div>
  )
}
