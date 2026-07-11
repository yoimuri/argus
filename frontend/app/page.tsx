import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import ThemeToggle from '@/components/theme/ThemeToggle'
import Reveal from '@/components/landing/Reveal'
import AuthLink from '@/components/landing/AuthLink'
import ContactModal from '@/components/landing/ContactModal'

// The public landing page (Sprint 4.4, D12). Until now `/` force-redirected to
// `/dashboard`, so anyone without an account -- a recruiter following the repo
// link -- hit a login wall. `/` is now a public marketing/intro page; proxy.ts
// lists it as a PUBLIC path. Authenticated visitors are NOT force-redirected;
// they just see a "Go to dashboard" action instead of "Sign in" (D12), served
// through AuthLink so a browser-cached copy of this page can never show a
// stale auth state (live-found 2026-07-11).
//
// Positioning (Clint, 2026-07-11): the headline story is turning messy,
// unorganized documents into clear, usable answers. Security is a supporting
// section, stated calmly, not an invitation to attack. Copy note: every claim
// here maps to something ARGUS actually does today -- the report-generation
// flow with figures is Sprint 4.6 and deliberately does NOT appear here until
// it ships.

const REPO_URL = 'https://github.com/yoimuri/argus'
const GITHUB_PROFILE = 'https://github.com/yoimuri'
const PORTFOLIO_URL = 'https://yoimuri.github.io'
const LINKEDIN_URL = 'https://www.linkedin.com/in/clint-branwel-p-b356a1364/'
// Professional contact address (Clint, 2026-07-11) -- his personal gmail must
// not appear on public pages.
const CONTACT_EMAIL = 'branwelclint.pro@gmail.com'

const PIPELINE: { name: string; role: string }[] = [
  { name: 'Orchestrator', role: 'Plans the query. It splits your question into sub-questions and decides whether a live web search is needed at all.' },
  { name: 'Web Scout', role: 'Pulls real-time web results when your documents alone fall short, and screens each snippet before it is used.' },
  { name: 'Retriever', role: 'Finds the most relevant passages in your uploaded documents by meaning, not keyword matching.' },
  { name: 'Synthesizer', role: 'Writes the answer, grounded only in the retrieved passages and vetted web snippets.' },
  { name: 'Critic', role: 'Checks the draft for claims the sources do not support, and sends it back for one revision if needed.' },
  { name: 'Reporter', role: 'Assembles the final answer with its sources and an honest confidence rating.' },
]

const DEFENSES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'Prompt-injection defense',
    body: 'Text from your PDFs and from the web is scanned for hidden instructions and framed by trust level before any model reads it.',
    icon: <ShieldIcon />,
  },
  {
    title: 'Circuit breakers',
    body: 'Each external service sits behind a breaker that fails cleanly instead of hanging or crashing a request.',
    icon: <BreakerIcon />,
  },
  {
    title: 'Row-level isolation',
    body: 'Your documents, research sessions, and security events are yours alone, enforced at the database, not just hidden in the UI.',
    icon: <LockIcon />,
  },
  {
    title: 'Live security console',
    body: 'A built-in dashboard shows blocked injection attempts and the health of every service in real time.',
    icon: <RadarIcon />,
  },
]

export default async function Landing() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const authed = Boolean(user)

  return (
    <div className="flex min-h-full flex-col">
      {/* noscript safety net: if JS is off, force every reveal wrapper visible
          so no content is ever hidden behind a script that never ran. */}
      <noscript>
        <style>{`.reveal[data-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3.5">
          <Link href="/" className="text-sm font-semibold tracking-[0.2em] text-ink">
            ARGUS
          </Link>
          {/* Section anchor nav (finding #5) -- same pattern as the portfolio
              site's clickable headers. Hidden on small screens where the
              sections are a short scroll away anyway. */}
          <nav className="hidden items-center gap-1 text-sm sm:flex">
            <a href="#how-it-works" className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink">
              How it works
            </a>
            <a href="#security" className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink">
              Security
            </a>
            <a href="#about" className="rounded-md px-3 py-1.5 text-ink-secondary transition-colors hover:bg-accent-wash hover:text-ink">
              Contact
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <AuthLink
              initialAuthed={authed}
              authedLabel="Go to dashboard →"
              anonLabel="Sign in"
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
            />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                'radial-gradient(60% 60% at 50% 0%, var(--color-accent-wash) 0%, transparent 70%)',
            }}
          />
          <div className="mx-auto max-w-4xl px-5 py-24 text-center sm:py-32">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1 text-xs font-medium text-ink-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Multi-agent research assistant
              </span>
            </Reveal>
            <Reveal delayMs={80}>
              <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
                Messy documents in. Clear answers out.
              </h1>
            </Reveal>
            <Reveal delayMs={160}>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-secondary">
                ARGUS reads raw, unorganized PDFs, finds what matters, and writes grounded answers
                with sources and an honest confidence rating. When the documents fall short, it
                searches the web and checks its own work.
              </p>
            </Reveal>
            <Reveal delayMs={240}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <AuthLink
                  initialAuthed={authed}
                  authedLabel="Go to dashboard"
                  anonLabel="Try ARGUS"
                  className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
                />
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-hairline-strong px-6 py-3 text-sm font-semibold text-ink transition-colors hover:bg-accent-wash"
                >
                  View the source
                </a>
              </div>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16 border-t border-hairline bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Six agents, one answer
              </h2>
              <p className="mt-4 text-pretty text-ink-secondary">
                A question doesn&apos;t go straight to a language model. It moves through a pipeline
                where each agent has one job, and every step is recorded so you can see exactly how
                the answer was reached.
              </p>
            </Reveal>

            <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PIPELINE.map((step, i) => (
                <li key={step.name}>
                  <Reveal delayMs={i * 60} className="h-full">
                    <div className="flex h-full flex-col gap-3 rounded-2xl border border-hairline bg-surface-raised p-6">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-wash font-mono text-sm font-semibold text-accent">
                          {i + 1}
                        </span>
                        <h3 className="font-semibold text-ink">{step.name}</h3>
                      </div>
                      <p className="text-sm leading-relaxed text-ink-secondary">{step.role}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security, stated calmly */}
        <section id="security" className="scroll-mt-16 border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Careful with your documents
              </h2>
              <p className="mt-4 text-pretty text-ink-secondary">
                A system that reads untrusted documents has to take security seriously. ARGUS does,
                quietly and by default.
              </p>
            </Reveal>

            <div className="mt-14 grid gap-4 sm:grid-cols-2">
              {DEFENSES.map((d, i) => (
                <Reveal key={d.title} delayMs={i * 70} className="h-full">
                  <div className="flex h-full gap-4 rounded-2xl border border-hairline bg-surface-raised p-6">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-wash text-accent">
                      {d.icon}
                    </span>
                    <div>
                      <h3 className="font-semibold text-ink">{d.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{d.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* About + contact */}
        <section id="about" className="scroll-mt-16 border-t border-hairline bg-surface">
          <div className="mx-auto max-w-4xl px-5 py-20 sm:py-24">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                About
              </h2>
            </Reveal>
            <Reveal delayMs={80}>
              <div className="mt-6 space-y-4 text-pretty leading-relaxed text-ink-secondary">
                <p>
                  ARGUS is an open-source portfolio project by{' '}
                  <span className="font-medium text-ink">Clint Branwel Poyaoan</span>, built to show
                  how a retrieval-augmented AI system is assembled, secured, and operated end to
                  end: the agent pipeline, the deployment, and the security testing behind it.
                </p>
                <p>
                  It runs on a FastAPI backend, a Next.js frontend, a Supabase Postgres database with
                  pgvector, LangGraph for the agent orchestration, and Groq for inference. The whole
                  build is documented in the open, including the mistakes.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={160}>
              <div className="mt-10 flex flex-wrap gap-3">
                <ContactModal
                  email={CONTACT_EMAIL}
                  linkedinUrl={LINKEDIN_URL}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
                />
                <a
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-hairline-strong px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-wash"
                >
                  LinkedIn
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-hairline-strong px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-wash"
                >
                  GitHub repo
                </a>
                <a
                  href={PORTFOLIO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-hairline-strong px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-accent-wash"
                >
                  Portfolio
                </a>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Footer: deliberately minimal. The contact/link buttons live in the
          About section directly above; repeating them here was flagged as
          redundant in the 2026-07-11 live review. */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-8 text-sm sm:flex-row">
          <span className="font-semibold tracking-[0.2em] text-ink-secondary">ARGUS</span>
          <span className="text-ink-muted">Multi-agent RAG research assistant · © 2026 Clint Branwel Poyaoan</span>
        </div>
      </footer>
    </div>
  )
}

/* Inline icons — no icon library is installed yet (that lands in the committed
   presentability pass; see ROADMAP owner notes). Hand-authored SVGs keep the
   landing page self-contained and CSP-clean in the meantime. */

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function BreakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 018 0v3.5" />
      <path d="M12 14.5v2" />
    </svg>
  )
}

function RadarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12l6-6" />
    </svg>
  )
}
