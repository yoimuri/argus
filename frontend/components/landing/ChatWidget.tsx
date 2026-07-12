'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'

// Public project-Q&A chatbot widget (Sprint 4.5), floating on the landing page
// for recruiters who'd rather ask than read. Calls our own backend /chat
// (already in the CSP connect-src via NEXT_PUBLIC_API_URL); the backend does
// the Gemini call server-side, defended by rate limiting + static grounding
// (ADR-021). Unauthenticated -- no token attached.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type Msg = { role: 'user' | 'bot'; text: string }

const GREETING: Msg = {
  role: 'bot',
  text: "Hi! I can answer questions about ARGUS — what it does, how it's built, or the security behind it. What would you like to know?",
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    const nextMessages: Msg[] = [...messages, { role: 'user', text }]
    setMessages(nextMessages)
    setSending(true)
    try {
      // Send prior real exchanges (skip the static greeting) as context.
      const history = nextMessages
        .slice(1, -1)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }))
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })
      if (res.status === 429) {
        setMessages((prev) => [
          ...prev,
          { role: 'bot', text: "You're sending messages a bit fast — give it a few seconds and try again." },
        ])
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { reply: string }
      setMessages((prev) => [...prev, { role: 'bot', text: data.reply }])
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'The assistant is resting right now. The backend also sleeps when idle, so the first message after a quiet spell can take up to a minute.' },
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close assistant' : 'Ask about ARGUS'}
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        {open ? <X size={20} strokeWidth={2} /> : <MessageCircle size={20} strokeWidth={2} />}
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[28rem] w-[calc(100vw-2.5rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-hairline bg-surface-raised shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline bg-surface px-4 py-3">
            <MessageCircle size={16} strokeWidth={1.75} className="text-accent" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">Ask about ARGUS</p>
              <p className="text-[11px] text-ink-muted">Answers about the project only.</p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ' +
                    (m.role === 'user'
                      ? 'bg-accent text-accent-contrast'
                      : 'bg-surface text-ink border border-hairline')
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-hairline bg-surface px-3 py-2 text-sm text-ink-muted">
                  <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
            className="flex items-center gap-2 border-t border-hairline p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question…"
              maxLength={1000}
              className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md bg-accent text-accent-contrast transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={16} strokeWidth={2} aria-hidden />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
