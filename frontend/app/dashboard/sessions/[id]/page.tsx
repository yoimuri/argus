import SessionDetail from './SessionDetail'

// Auth already guarded by dashboard/layout.tsx. Next.js 16: params is a
// Promise (frontend/AGENTS.md -- this version differs from training data),
// must be awaited before use.
export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <SessionDetail sessionId={id} />
}
