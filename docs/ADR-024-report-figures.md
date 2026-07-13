# ADR-024: Generated figures in reports (Sprint 4.6b) — specs, not images

**Status:** Accepted, 2026-07-14
**Context:** The owner-locked scope for 4.6b (PHASE4, 2026-07-11): reports should carry real
charts — "bar graph, histogram, or similar" — built from the documents' data, explicitly **NOT AI
image generation**. The design question was where chart rendering lives and what the model is
allowed to produce.

## 1. The core decision: the model emits a chart SPEC, never an image

During report writing (both Quick and Full modes), the prompt permits up to two fenced blocks:

```chart
{"type": "bar", "title": "Breaches by sector", "labels": ["Health", "Finance"],
 "values": [412, 268], "y_label": "incidents"}
```

`figures.extract_figures()` then pulls these out of the generated Markdown and **hard-validates**
each one (`validate_figure_spec`): whitelisted type (`bar`/`line`), rebuilt-from-scratch dict (no
unexamined key survives), 2–12 points, finite numbers only, every string length-capped, at most 3
figures per report. Survivors are stored as `reports.figures` JSON (migration 020) and the body
keeps a `[[figure:N]]` marker where each belongs; invalid blocks are stripped silently — a bad
chart degrades to *no* chart, never to a broken report.

Why specs and not images: a spec is small (bytes, not kilobytes), auditable (you can read exactly
what the model claimed), storable in a JSON column with no Storage/CSP changes, re-renderable at
any fidelity, and it structurally *cannot* smuggle content the way an opaque generated image
could. It is also the honest framing of the capability: ARGUS charts numbers found in your
documents; it does not imagine pictures. Grounding is enforced in the prompt ("every value MUST
be a number stated in the source material") and disclaimed in the product (the always-visible
proofread-before-use banner covers misread figures — the same honesty contract as the text).

## 2. Rendering lives at the edges, twice

| Surface | Renderer | Why |
|---|---|---|
| Report page (preview) | `ChartFigure.tsx` — plain SVG, no chart library | Two single-series forms don't justify a dependency; design tokens make it theme-aware (the same spec reads correctly in light and dark) |
| `.docx` / `.pdf` downloads | `figures.render_figure_png()` — matplotlib, Agg backend | The one place a raster is genuinely needed; python-docx/fpdf2 both embed PNG natively |

Both renderers follow the dataviz skill's validated specs: a single series wears the brand accent
(no legend box — the title names it); hairline solid gridlines; value labels in ink tokens, never
the series color; bars with rounded data-ends and square baselines; 2px lines with a
surface-ringed end marker; values labeled directly because a report figure is *static* — there is
no tooltip channel in a .docx.

## 3. The 512 MB question — how matplotlib fits the dyno, honestly

matplotlib+numpy cost ~100–150 MB RSS **when imported**. The design keeps that off the steady
state: the import happens lazily inside `render_figure_png()`, so it is paid only during a
download request, never at boot, and the report-generation path itself never touches it (specs
are extracted with a regex + JSON parse). Residual risk, stated plainly: a download request
arriving while a research run has langgraph loaded stacks both footprints; whether that fits the
512 MB dyno is **a live measurement, not an assumption** — it is GATE-30's memory check, and if
it OOMs, the fallback path already exists (figure data renders as plain text lines,
`figure_fallback_lines`, so downloads still work — without charts — while we reconsider).

## 4. Failure behavior (everything degrades, nothing breaks)

- Invalid/oversized/hallucinated-shape spec → stripped at extraction; report ships without it.
- matplotlib missing or render error → `figure_fallback_lines()` prints the chart's data as text
  in the export; the numbers still reach the reader.
- Migration 020 not yet applied → the completed-write retries without the `figures` column
  (`_patch_completed`), so a finished report is never lost to deploy order; the body's markers
  render as nothing client-side (no specs to match) rather than erroring.

## 5. Out of scope

Histogram/pie/scatter types (bar+line cover the observed need; each new type is new validation
surface), multi-series charts (legend/color-order rules kick in — revisit with a real use case),
and reading figures *inside* uploaded PDFs (that is 4.6c's vision work, which still gets its own
threat-model ADR first).
