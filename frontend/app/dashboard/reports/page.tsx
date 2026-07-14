import ReportsList from './ReportsList'
import PageHeader from '@/components/ui/PageHeader'

// Sprint 4.6a (D17): generated reports live at their own route, like sessions
// -- deep-linkable, pollable while generating. Auth guarded by dashboard/layout.tsx.
export default function ReportsPage() {
  return (
    <div className="rise space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Formatted reports generated from your collections. Open one to preview it and download it as an editable .docx."
      />
      <ReportsList />
    </div>
  )
}
