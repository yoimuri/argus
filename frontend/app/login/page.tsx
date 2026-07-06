import LoginForm from './LoginForm'

// Nonce-based CSP (proxy.ts) requires this page to be dynamically rendered: a
// statically-built page has no per-request nonce to bake into Next's inline
// hydration script, so the browser blocks it under a strict script-src with no
// 'unsafe-inline' fallback. force-dynamic only works from a Server Component
// module — a 'use client' page silently ignores this export, which is why the
// interactive form lives in the separate LoginForm client component (same
// split already used by dashboard/page.tsx + UploadPanel.tsx).
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return <LoginForm />
}
