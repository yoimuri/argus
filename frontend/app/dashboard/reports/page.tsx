import ReportsList from './ReportsList'

// Sprint 4.6a (D17): generated reports live at their own route, like sessions
// -- deep-linkable, pollable while generating. Auth guarded by dashboard/layout.tsx.
export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-semibold text-ink">Reports</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Formatted reports generated from your collections. Open one to preview it and
          download it as .docx or PDF.
        </p>
      </div>
      <ReportsList />
    </div>
  )
}
