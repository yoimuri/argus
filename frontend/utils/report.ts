// Splits a research_sessions.report string into its parts for the UI
// (D6): reporter.py builds the string as
//   "## Answer\n\n{answer}\n{banner}\n## Sources\n\n{sources}\n{badge}"   (banner present)
//   "## Answer\n\n{answer}\n\n## Sources\n\n{sources}\n{badge}"          (no banner)
//   "## Answer\n\n{answer}\n{banner}{badge}"                             (no chunks/sources at all)
// where badge = "\n## Confidence\n\n...". Older stored sessions (pre-Sprint
// 4.1) put the banner between Sources and Confidence instead of right after
// the Answer -- this walks whichever "## Heading" markers are actually
// present rather than assuming a fixed order, so both old and new reports
// parse the same way. Pure function: works on a live response and a
// historical research_sessions.report string identically, zero backend change.

export type ConfidenceLevel = 'high' | 'low' | 'unassessed'

export interface SplitReport {
  answer: string
  sources: string | null
  confidence: string
  confidenceLevel: ConfidenceLevel
  banner: string | null
}

const BANNER_TEXT =
  '*Live web search was unavailable for this run — answering from your documents only.*'

const HEADING_RE = /^##\s+(Answer|Sources|Confidence)\s*$/gm

export function splitReport(raw: string): SplitReport {
  const hasBanner = raw.includes(BANNER_TEXT)
  const body = hasBanner ? raw.replace(BANNER_TEXT, '').trim() : raw.trim()

  const sections: Partial<Record<'Answer' | 'Sources' | 'Confidence', string>> = {}
  const matches = [...body.matchAll(HEADING_RE)]

  for (let i = 0; i < matches.length; i++) {
    const name = matches[i][1] as 'Answer' | 'Sources' | 'Confidence'
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length
    sections[name] = body.slice(start, end).trim()
  }

  const confidence = sections.Confidence ?? ''
  let confidenceLevel: ConfidenceLevel = 'unassessed'
  if (confidence.startsWith('High')) confidenceLevel = 'high'
  else if (confidence.includes('Low')) confidenceLevel = 'low'

  return {
    answer: sections.Answer ?? body,
    sources: sections.Sources ?? null,
    confidence,
    confidenceLevel,
    banner: hasBanner ? BANNER_TEXT : null,
  }
}
