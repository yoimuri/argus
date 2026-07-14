'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// A ready-to-paste example prompt for the assistant (Sprint 4.7, #6). Shows the
// text in a monospace block with a Copy button, so a user can drop it straight
// into the chatbot and get a step-by-step answer.
export default function CopyablePrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions/http); the text stays selectable
      // by hand, so failing quietly is fine.
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-hairline bg-surface-page px-3 py-2">
      <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-ink-secondary">
        {text}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline px-2 py-1 text-xs text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink"
      >
        {copied ? <Check size={13} strokeWidth={2} aria-hidden /> : <Copy size={13} strokeWidth={1.75} aria-hidden />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
