import Link from 'next/link'
import { createClient } from '@/utils/supabase/server'
import ThemeToggle from '@/components/theme/ThemeToggle'
import Reveal from '@/components/landing/Reveal'

// The public landing page (Sprint 4.4, D12). Until now `/` force-redirected to
// `/dashboard`, so anyone without an account -- a recruiter following the repo
// link -- hit a login wall. `/` is now a public marketing/intro page; proxy.ts
// lists it as a PUBLIC path. Authenticated visitors are NOT force-redirected;
// they just see a "Go to dashboard" action instead of "Sign in" (D12).
//
// Copy note: every claim here maps to something ARGUS actually does (the real
// six-agent pipeline, the real injection defenses, RLS isolation, the SOC
// console). Nothing is inflated -- the project rule that docs never claim more
// than the code does applies to the public page most of all.

const REPO_URL = 'https://github.com/yoimuri/argus'
const GITHUB_PROFILE = 'https://github.com/yoimuri'
// TODO(Clint): confirm these two before this ships publicly. Portfolio URL is
// from the portfolio-v2 plan; LinkedIn I don't have on file -- fill it in or
// tell me to remove the link.
const PORTFOLIO_URL = 'https://yoimuri.github.io'
const CONTACT_EMAIL = 'branwelclint@gmail.com'

const PIPELINE: { name: string; role: string }[] = [
  { name: 'Orchestrator', role: 'Plans the query — splits it into sub-questions and decides whether a live web search is even needed.' },
  { name: 'Web Scout', role: 'Pulls real-time web results when the documents alone fall short, scanning each snippet for hidden instructions.' },
  { name: 'Retriever', role: 'Finds the most relevant passages from your uploaded documents by meaning, not keyword matching.' },
  { name: 'Synthesizer', role: 'Writes the answer, grounded only in the retrieved passages and vetted web snippets.' },
  { name: 'Critic', role: 'Checks the draft for claims the sources do not support, and sends it back for one revision if needed.' },
  { name: 'Reporter', role: 'Assembles the final answer with its sources and an honest confidence rating.' },
]

const DEFENSES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'Prompt-injection defense',
    body: 'Every piece of text — from your PDFs and from the web — is scanned for hidden instructions and framed by trust level before any model reads it.',
    icon: <ShieldIcon />,
  },
  {
    title: 'Circuit breakers',
    body: 'Each external service (embeddings, web search, the safety classifier) sits behind a breaker that fails cleanly instead of hanging or crashing a request.',
    icon: <BreakerIcon />,
  },
  {
    title: 'Row-level isolation',
    body: 'Your documents, research sessions, and security events are yours alone — enforced at the database with row-level security, not just hidden in the UI.',
    icon: <LockIcon />,
  },
  {
    title: 'Live security console',
    body: 'A built-in SOC dashboard shows blocked injection attempts and the health of every service in real time — the defenses are visible, not just claimed.',
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
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            {authed ? (
              <Link
                href="/dashboard"
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to dashboard →
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Sign in
              </Link>
            )}
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
                Multi-agent RAG · prompt-injection defense
              </span>
            </Reveal>
            <Reveal delayMs={80}>
              <h1 className="mt-6 text-balance text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-6xl">
                Turn your documents into answers you can trust.
              </h1>
            </Reveal>
            <Reveal delayMs={160}>
              <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-ink-secondary">
                ARGUS is a multi-agent research assistant that reads your PDFs, searches the web
                when it needs to, and defends every step against prompt-injection attacks — with a
                live security console to prove it.
              </p>
            </Reveal>
            <Reveal delayMs={240}>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={authed ? '/dashboard' : '/login'}
                  className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  {authed ? 'Go to dashboard' : 'Try ARGUS'}
                </Link>
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
        <section className="border-t border-hairline bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Six agents, one answer
              </h2>
              <p className="mt-4 text-pretty text-ink-secondary">
                A question doesn&apos;t go straight to a language model. It moves through a pipeline
                where each agent has one job — and every step is recorded so you can see exactly how
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

        {/* Security story */}
        <section className="border-t border-hairline">
          <div className="mx-auto max-w-6xl px-5 py-20 sm:py-24">
            <Reveal className="mx-auto max-w-2xl text-center">
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Built to be attacked
              </h2>
              <p className="mt-4 text-pretty text-ink-secondary">
                Any system that feeds untrusted text to a language model is a target. ARGUS treats
                that as the starting assumption, not an afterthought.
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
        <section className="border-t border-hairline bg-surface">
          <div className="mx-auto max-w-4xl px-5 py-20 sm:py-24">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                About
              </h2>
            </Reveal>
            <Reveal delayMs={80}>
              <div className="mt-6 space-y-4 text-pretty leading-relaxed text-ink-secondary">
                <p>
                  ARGUS is an open-source portfolio and thesis project by{' '}
                  <span className="font-medium text-ink">Clint Branwel Poyaoan</span>, built to show
                  how a retrieval-augmented AI system can be assembled, secured, and operated end to
                  end — from the agent pipeline down to the deployment and the security testing that
                  proves the defenses hold.
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
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=ARGUS%20%E2%80%94%20professional%20inquiry`}
                  className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  Get in touch
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

      {/* Footer */}
      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-sm text-ink-muted sm:flex-row">
          <span className="font-semibold tracking-[0.2em] text-ink-secondary">ARGUS</span>
          <div className="flex items-center gap-5">
            <a href={GITHUB_PROFILE} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
              GitHub
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink">
              Email
            </a>
            <Link href={authed ? '/dashboard' : '/login'} className="hover:text-ink">
              {authed ? 'Dashboard' : 'Sign in'}
            </Link>
          </div>
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
