import type { LucideIcon } from 'lucide-react'
import { Lightbulb, Search, FileText, History, ShieldCheck, MessageCircle, Settings } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import GuidedTour from '@/components/dashboard/GuidedTour'
import CopyablePrompt from '@/components/dashboard/CopyablePrompt'
import { buttonClasses } from '@/components/ui/Button'

// How-to guide (Sprint 4.7, #6). Auth guarded by dashboard/layout.tsx. Plain,
// step-by-step, in the owner's own voice: one section per feature, each a short
// numbered list. Includes the interactive tour launcher and copy-paste prompts
// for the assistant, so a first-time user has three ways in (read, tour, ask).

function Section({
  icon: Icon,
  title,
  intro,
  steps,
  children,
}: {
  icon: LucideIcon
  title: string
  intro?: string
  steps?: string[]
  children?: React.ReactNode
}) {
  return (
    <Card>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
          <Icon size={17} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      {intro && <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{intro}</p>}
      {steps && (
        <ol className="mt-3 space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-ink-secondary">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-wash text-xs font-semibold text-accent">
                {i + 1}
              </span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      )}
      {children}
    </Card>
  )
}

export default function HowToPage() {
  return (
    <div className="rise space-y-5">
      <PageHeader
        title="How to use ARGUS"
        subtitle="ARGUS reads your PDFs and answers questions with sources, or writes a formatted report, and always shows how it got there. Here is how to use each part."
      />

      {/* Three ways in: read below, take the tour, or ask the assistant. */}
      <Card className="flex flex-wrap items-center justify-between gap-3 border-accent-wash-strong bg-accent-wash">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">New here? Take the 60-second tour</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            It walks you around the app and highlights each part as it explains it.
          </p>
        </div>
        <GuidedTour className={buttonClasses('primary', 'md')} />
      </Card>

      <Section
        icon={Lightbulb}
        title="The big idea"
        intro="You give ARGUS a set of PDFs. It can answer questions about them with citations and a confidence rating, or turn the whole set into a formatted report. Everything it says is grounded in your documents, and you can always see the sources and the steps it took."
      />

      <Section
        icon={Search}
        title="Ask a question"
        steps={[
          'Go to Workspace.',
          'Create a collection. Think of it as a folder for related PDFs. Give it a name.',
          'Upload a PDF into it. You get a preview before it uploads. Wait until it shows as ready.',
          'Type your question and press Ask.',
          'Read the answer. It shows a confidence badge and the Sources it used. Click Show details to see the exact passages and why it rated the confidence the way it did.',
        ]}
      >
        <p className="mt-3 text-xs text-ink-muted">
          Tip: the first action after a quiet spell can take 30 to 60 seconds. That is the free
          server waking up, not a problem.
        </p>
      </Section>

      <Section
        icon={FileText}
        title="Generate a report"
        steps={[
          'In the Workspace, click Generate report.',
          'Pick Quick draft (fast, reads a representative sample) or Full report (thorough, reads everything, takes minutes).',
          'Watch the progress bar. When it finishes, preview the report on screen.',
          'Download it as an editable .docx. Always proofread it before sharing or acting on it.',
        ]}
      >
        <p className="mt-3 text-xs text-ink-muted">
          A report is an AI draft. For a large set of PDFs you get the most complete result by
          splitting it into focused collections and generating one report each.
        </p>
      </Section>

      <Section
        icon={History}
        title="See how it answered"
        steps={[
          'Open Sessions.',
          'Click any past question.',
          'You see the step-by-step trace: each of the six AI agents, what it did, and how long it took. This is how ARGUS proves its answer instead of asking you to trust it.',
        ]}
      />

      <Section
        icon={ShieldCheck}
        title="The SOC page (your security view)"
        intro="SOC stands for Security Operations Center, the place a real company uses to watch its systems for attacks. This is your personal version of that view."
        steps={[
          'Open SOC.',
          'Circuit breakers show whether the AI services ARGUS depends on are healthy. Green means healthy. If one trips (red), ARGUS degrades gracefully instead of crashing, and recovers on its own.',
          'Security events list the moments ARGUS blocked something suspicious in your account, like a prompt-injection attempt hidden in a document or typed into the question box.',
          'Seeing entries here is the defense working, not something being wrong.',
        ]}
      />

      <Section
        icon={MessageCircle}
        title="Ask the assistant for a walkthrough"
        intro="The chat button at the bottom right can walk you through anything, step by step. Copy one of these and paste it into the chat:"
      >
        <div className="mt-3 space-y-2">
          <CopyablePrompt text="How do I generate a report, step by step?" />
          <CopyablePrompt text="Walk me through asking my first question." />
          <CopyablePrompt text="What does the SOC page show and how do I read it?" />
        </div>
      </Section>

      <Section
        icon={Settings}
        title="Settings and limits"
        intro="In Settings you can switch between light and dark theme, see your free-tier usage bars, and manage your account. The limits are there to keep the free tier fair, reach out if you need them raised."
      />
    </div>
  )
}
