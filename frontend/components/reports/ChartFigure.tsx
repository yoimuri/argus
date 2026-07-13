// Sprint 4.6b (ADR-024): renders one validated chart SPEC as an inline SVG in
// the report preview. Deliberately dependency-free (no chart library for two
// small single-series forms) and theme-aware: every color is a design token,
// so the same spec reads correctly in light and dark. Styling follows the
// dataviz skill's validated specs: single series wears the brand accent and
// gets NO legend box (the title names it); gridlines are hairline and solid;
// value labels wear ink tokens, never the series color; bars get a rounded
// data-end and a square baseline; the line is 2px with a surface-ringed end
// marker. Values are labeled directly because a report figure is a STATIC
// artifact — the .docx/.pdf renders have no tooltip channel, and the preview
// mirrors them.
export interface FigureSpec {
  type: 'bar' | 'line'
  title: string
  labels: string[]
  values: number[]
  y_label?: string
}

const VIEW_W = 640
const VIEW_H = 300
const MARGIN = { top: 16, right: 40, bottom: 34, left: 52 }
const PLOT_W = VIEW_W - MARGIN.left - MARGIN.right
const PLOT_H = VIEW_H - MARGIN.top - MARGIN.bottom

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// A clean axis ceiling (1/2/2.5/5 × 10^n above the max) so ticks land on
// round numbers instead of the data max.
function niceCeiling(maxValue: number): number {
  if (maxValue <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(maxValue)))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (maxValue <= step * power) return step * power
  }
  return 10 * power
}

function truncate(label: string, max = 10): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

export default function ChartFigure({ spec }: { spec: FigureSpec }) {
  const { labels, values } = spec
  if (!labels?.length || labels.length !== values?.length) return null

  const ceiling = niceCeiling(Math.max(...values, 0))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * ceiling)
  const yFor = (value: number) => MARGIN.top + PLOT_H - (Math.max(value, 0) / ceiling) * PLOT_H
  const band = PLOT_W / labels.length

  return (
    <figure className="my-4 rounded-lg border border-hairline bg-surface p-4">
      <figcaption className="mb-2 text-sm font-semibold text-ink">{spec.title}</figcaption>
      {spec.y_label && <p className="mb-1 text-[11px] text-ink-muted">{spec.y_label}</p>}
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${spec.type === 'bar' ? 'Bar' : 'Line'} chart: ${spec.title}`}
      >
        {/* Hairline solid horizontal gridlines + tabular y-ticks (muted ink). */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={MARGIN.left}
              x2={VIEW_W - MARGIN.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="var(--color-hairline)"
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 8}
              y={yFor(tick) + 3.5}
              textAnchor="end"
              fontSize={10.5}
              fill="var(--color-ink-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {spec.type === 'bar' &&
          labels.map((label, i) => {
            const barWidth = Math.min(band * 0.6, 40)
            const x = MARGIN.left + band * i + (band - barWidth) / 2
            const y = yFor(values[i])
            const height = Math.max(MARGIN.top + PLOT_H - y, 0)
            const radius = Math.min(4, barWidth / 2, height)
            return (
              <g key={i}>
                {/* Rounded data-end, square baseline: a path, not a rect. */}
                <path
                  d={`M ${x} ${y + height}
                      L ${x} ${y + radius}
                      Q ${x} ${y} ${x + radius} ${y}
                      L ${x + barWidth - radius} ${y}
                      Q ${x + barWidth} ${y} ${x + barWidth} ${y + radius}
                      L ${x + barWidth} ${y + height} Z`}
                  fill="var(--color-accent)"
                />
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-ink-secondary)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatValue(values[i])}
                </text>
              </g>
            )
          })}

        {spec.type === 'line' && (
          <>
            <polyline
              points={values
                .map((value, i) => `${MARGIN.left + band * i + band / 2},${yFor(value)}`)
                .join(' ')}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* End marker with a 2px surface ring; the endpoint carries the
                direct label (label selectively — never every point). */}
            <circle
              cx={MARGIN.left + band * (values.length - 1) + band / 2}
              cy={yFor(values[values.length - 1])}
              r={4.5}
              fill="var(--color-accent)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
            <text
              x={MARGIN.left + band * (values.length - 1) + band / 2 + 9}
              y={yFor(values[values.length - 1]) + 3.5}
              fontSize={11}
              fill="var(--color-ink-secondary)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(values[values.length - 1])}
            </text>
          </>
        )}

        {/* Baseline + x labels. */}
        <line
          x1={MARGIN.left}
          x2={VIEW_W - MARGIN.right}
          y1={MARGIN.top + PLOT_H}
          y2={MARGIN.top + PLOT_H}
          stroke="var(--color-hairline-strong)"
          strokeWidth={1}
        />
        {labels.map((label, i) => (
          <text
            key={i}
            x={MARGIN.left + band * i + band / 2}
            y={MARGIN.top + PLOT_H + 16}
            textAnchor="middle"
            fontSize={10.5}
            fill="var(--color-ink-muted)"
          >
            <title>{label}</title>
            {truncate(label)}
          </text>
        ))}
      </svg>
    </figure>
  )
}
