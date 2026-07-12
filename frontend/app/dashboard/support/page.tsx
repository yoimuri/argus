'use client'

import { useState } from 'react'
// Lucide dropped brand glyphs (Linkedin/Github) from current releases, so the
// LinkedIn and GitHub cards wear semantic icons instead of logos.
import { Mail, Briefcase, Bug, LifeBuoy, Copy, Check } from 'lucide-react'

// Contact/support page inside the logged-in app (Clint's request, 2026-07-11).
// Honest about what this is: a portfolio proof-of-concept run by one person,
// not a staffed helpdesk -- expectations are stated instead of implied.
// The email is deliberately NOT a mailto link (Clint, 2026-07-12): clicking it
// hijacks the visitor into whatever mail app the OS registered. They copy the
// address and use their own mail client instead.
const CONTACT_EMAIL = 'branwelclint.pro@gmail.com'
const LINKEDIN_URL = 'https://www.linkedin.com/in/clint-branwel-p-b356a1364/'
const ISSUES_URL = 'https://github.com/yoimuri/argus/issues'

export default function SupportPage() {
  const [copied, setCopied] = useState(false)

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (permissions, http); the address is visible
      // on screen either way, so there's nothing further to do.
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <LifeBuoy size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
          Support
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Questions, bug reports, or a request to raise your free-tier limits.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline bg-surface p-4">
          <Mail size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">Email</p>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="break-all text-xs text-ink-muted">{CONTACT_EMAIL}</p>
            <button
              type="button"
              onClick={copyEmail}
              aria-label={copied ? 'Email copied' : 'Copy email address'}
              title={copied ? 'Copied!' : 'Copy'}
              className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-accent-wash hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {copied ? (
                <Check size={13} strokeWidth={2} className="text-good" aria-hidden />
              ) : (
                <Copy size={13} strokeWidth={2} aria-hidden />
              )}
            </button>
            {copied && <span className="text-[11px] text-ink-muted">Copied</span>}
          </div>
        </div>
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-hairline bg-surface p-4 transition-colors hover:bg-accent-wash"
        >
          <Briefcase size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">LinkedIn ↗</p>
          <p className="mt-0.5 text-xs text-ink-muted">Clint Branwel Poyaoan</p>
        </a>
        <a
          href={ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-hairline bg-surface p-4 transition-colors hover:bg-accent-wash sm:col-span-2"
        >
          <Bug size={18} strokeWidth={1.75} className="text-accent" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">Report a bug on GitHub ↗</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Found something broken? An issue with steps to reproduce is the fastest way to get it
            fixed.
          </p>
        </a>
      </div>

      <p className="rounded-lg border border-hairline bg-surface p-4 text-xs leading-relaxed text-ink-muted">
        ARGUS is an open-source proof-of-concept maintained by one person, so replies come from a
        human on a human schedule, usually within a few days, not minutes. For anything about your
        data, see the Data &amp; privacy section in Settings.
      </p>
    </div>
  )
}
