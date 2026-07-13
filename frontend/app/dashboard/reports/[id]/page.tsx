import ReportView from './ReportView'

// Auth guarded by dashboard/layout.tsx. Next.js 16: params is a Promise
// (frontend/AGENTS.md), must be awaited before use — same as sessions/[id].
export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ReportView reportId={id} />
}
