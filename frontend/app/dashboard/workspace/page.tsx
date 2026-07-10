import UploadPanel from '../UploadPanel'

// Workspace split out of /dashboard (2026-07-10 shell rework): the old
// dashboard route now holds the overview; the collections/upload/query
// surface lives here. Auth is guarded by dashboard/layout.tsx.
export default function WorkspacePage() {
  return (
    <div>
      <h1 className="text-base font-semibold text-ink">Workspace</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Create a collection, upload PDFs, and ask questions about their content.
      </p>
      <UploadPanel />
    </div>
  )
}
