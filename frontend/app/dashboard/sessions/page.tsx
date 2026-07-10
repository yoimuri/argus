import SessionList from './SessionList'

// Auth already guarded by dashboard/layout.tsx. D1: deep-linkable session
// URLs are the point of the Debug Diary -- a real route, not a tab.
export default function SessionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold text-ink">Sessions</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Your past research runs. Open one to see the step-by-step execution trace.
        </p>
      </div>
      <SessionList />
    </div>
  )
}
