import UploadPanel from '../UploadPanel'
import PageHeader from '@/components/ui/PageHeader'

// Workspace split out of /dashboard (2026-07-10 shell rework): the old
// dashboard route now holds the overview; the collections/upload/query
// surface lives here. Auth is guarded by dashboard/layout.tsx.
export default function WorkspacePage() {
  return (
    <div className="rise space-y-5">
      <PageHeader
        title="Workspace"
        subtitle="Create a collection, upload PDFs, and ask questions about their content."
      />
      <UploadPanel />
    </div>
  )
}
