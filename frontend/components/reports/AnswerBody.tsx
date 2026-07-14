'use client'

import ReactMarkdown from 'react-markdown'
import ChartFigure, { type FigureSpec } from '@/components/reports/ChartFigure'

// Renders an Ask answer, turning any ```chart fenced block the synthesizer
// emitted (Sprint 4.7, #3) into a real chart via the same ChartFigure the
// reports use, instead of the model's old ASCII-art or "I can't display it".
//
// The spec is UNTRUSTED (model output derived from documents), so it is
// hard-validated here and rebuilt from scratch: only bar/line, 2-12 finite
// numeric points, length-capped labels. An invalid or injected block is dropped
// silently (never leaked as raw JSON, never rendered). A chart can't execute
// anything, it's just numbers drawn as SVG, so client-side validation is enough
// for render safety; grounding (numbers must be in the source) is enforced by
// the synthesizer prompt and covered by the confidence badge + proofread rule.
const CHART_FENCE = /```chart\s*\n([\s\S]*?)```/g

function validate(raw: string): FigureSpec | null {
  try {
    const o = JSON.parse(raw)
    if (o.type !== 'bar' && o.type !== 'line') return null
    if (typeof o.title !== 'string') return null
    if (!Array.isArray(o.labels) || !Array.isArray(o.values)) return null
    if (o.labels.length !== o.values.length) return null
    if (o.labels.length < 2 || o.labels.length > 12) return null
    const values = o.values.map((v: unknown) => Number(v))
    if (values.some((v: number) => !Number.isFinite(v))) return null
    return {
      type: o.type,
      title: String(o.title).slice(0, 80),
      labels: o.labels.map((l: unknown) => String(l).slice(0, 24)),
      values,
      y_label: typeof o.y_label === 'string' ? o.y_label.slice(0, 32) : undefined,
    }
  } catch {
    return null
  }
}

type Part = { kind: 'md'; text: string } | { kind: 'chart'; spec: FigureSpec }

export default function AnswerBody({ markdown }: { markdown: string }) {
  const parts: Part[] = []
  let last = 0
  for (const m of markdown.matchAll(CHART_FENCE)) {
    const idx = m.index ?? 0
    const before = markdown.slice(last, idx)
    if (before.trim()) parts.push({ kind: 'md', text: before })
    const spec = validate(m[1])
    if (spec) parts.push({ kind: 'chart', spec })
    last = idx + m[0].length
  }
  const tail = markdown.slice(last)
  if (tail.trim() || parts.length === 0) parts.push({ kind: 'md', text: tail })

  return (
    <div className="space-y-3 leading-relaxed">
      {parts.map((p, i) =>
        p.kind === 'md' ? (
          <ReactMarkdown key={i}>{p.text}</ReactMarkdown>
        ) : (
          <ChartFigure key={i} spec={p.spec} />
        ),
      )}
    </div>
  )
}
