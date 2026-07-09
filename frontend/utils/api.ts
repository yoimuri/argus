import { createClient } from '@/utils/supabase/client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export class ApiError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`API error ${status}${body ? `: ${body}` : ''}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function getAccessToken(): Promise<string | undefined> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
}

// Shared fetch helper (Sprint 4.2, D3) -- every hand-rolled getToken()+fetch
// block in UploadPanel.tsx (and every new panel from here on) goes through
// this instead, so the Bearer-token wiring and error handling live in one
// place. Standard RequestInit.signal still flows through via the spread
// below, so Sprint 4.3's cancel support (AbortController) needs no change
// here -- callers just pass { signal } like any other fetch call.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(res.status, body)
  }
  return res
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  return (await res.json()) as T
}
