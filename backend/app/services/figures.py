"""Sprint 4.6b (ADR-024) — generated figures: chart SPECS in, rendered charts out.

The model never produces an image (owner decision, 2026-07-11: charts from the
documents' own numbers, explicitly NOT AI image generation). Instead the
report prompt lets it emit small fenced chart blocks:

    ```chart
    {"type": "bar", "title": "Breaches by sector", "labels": [...], "values": [...]}
    ```

extract_figures() pulls those out of the generated Markdown, validates each
spec hard (whitelisted keys, bounded sizes, finite numbers — a spec is data,
never code), stores the survivors as the report's `figures` JSON (migration
020), and replaces each fence with a [[figure:N]] marker in the body text.
Invalid blocks are silently stripped: a bad chart degrades to no chart, never
to a broken report.

Rendering happens at the edges, from the same specs:
- the report page draws them client-side as SVG (ChartFigure.tsx, theme-aware);
- the .docx/.pdf downloads call render_figure_png() here — matplotlib on the
  Agg backend, imported LAZILY inside the function so the ~100MB+
  matplotlib/numpy footprint is only paid on a download request, never at boot
  (512MB dyno). If matplotlib is unavailable or rendering fails, exporters
  fall back to figure_fallback_lines() — the data as plain text: honest, and
  never a broken download.

Chart styling follows the dataviz skill's validated specs (single series → the
brand accent, no legend box; hairline solid gridlines; value labels in ink,
never the series color; 2px line with a surface-ringed end marker).
"""
import json
import math
import re

# Bounds: a spec is untrusted model output derived from untrusted documents.
# Everything is length-capped and type-checked; anything outside the envelope
# invalidates the whole spec.
MAX_FIGURES = 3
MAX_POINTS = 12
MIN_POINTS = 2
MAX_TITLE_CHARS = 80
MAX_LABEL_CHARS = 24
MAX_AXIS_LABEL_CHARS = 32
MAX_ABS_VALUE = 1e12

CHART_FENCE = re.compile(r"```chart\s*\n(.*?)```", re.DOTALL)
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

# Light-page render colors (the .docx/.pdf page is white): ARGUS's validated
# light accent for the single data series; chrome/ink from the dataviz skill's
# reference palette. Text never wears the series color.
_ACCENT = "#0e7490"
_INK = "#0b0b0b"
_INK_SECONDARY = "#52514e"
_INK_MUTED = "#898781"
_GRIDLINE = "#e1e0d9"
_BASELINE = "#c3c2b7"


def _clean_text(value, cap: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = _CONTROL_CHARS.sub(" ", value).strip()
    return text[:cap] if text else None


def validate_figure_spec(raw) -> dict | None:
    """Whitelist-validate one parsed chart spec. Returns the cleaned spec or
    None. No key passes through unexamined — the output dict is rebuilt from
    scratch, so a spec can never carry extra payload into the DB row."""
    if not isinstance(raw, dict):
        return None
    chart_type = raw.get("type")
    if chart_type not in ("bar", "line"):
        return None
    title = _clean_text(raw.get("title"), MAX_TITLE_CHARS)
    if not title:
        return None

    labels_raw = raw.get("labels")
    values_raw = raw.get("values")
    if not isinstance(labels_raw, list) or not isinstance(values_raw, list):
        return None
    if not (MIN_POINTS <= len(labels_raw) <= MAX_POINTS):
        return None
    if len(labels_raw) != len(values_raw):
        return None

    labels: list[str] = []
    for item in labels_raw:
        text = _clean_text(str(item) if isinstance(item, (int, float)) else item,
                           MAX_LABEL_CHARS)
        if not text:
            return None
        labels.append(text)

    values: list[float] = []
    for item in values_raw:
        if isinstance(item, bool) or not isinstance(item, (int, float)):
            return None
        number = float(item)
        if not math.isfinite(number) or abs(number) > MAX_ABS_VALUE:
            return None
        values.append(number)

    spec = {"type": chart_type, "title": title, "labels": labels, "values": values}
    y_label = _clean_text(raw.get("y_label"), MAX_AXIS_LABEL_CHARS)
    if y_label:
        spec["y_label"] = y_label
    return spec


def extract_figures(report_md: str) -> tuple[str, list[dict]]:
    """Pull ```chart fences out of generated Markdown. Valid specs (up to
    MAX_FIGURES) become [[figure:N]] markers + returned specs; invalid or
    over-budget fences are stripped entirely. Always returns a body with no
    chart fences left in it."""
    figures: list[dict] = []

    def _replace(match: re.Match) -> str:
        if len(figures) >= MAX_FIGURES:
            return ""
        try:
            parsed = json.loads(match.group(1).strip())
        except (json.JSONDecodeError, ValueError):
            return ""
        spec = validate_figure_spec(parsed)
        if spec is None:
            return ""
        figures.append(spec)
        return f"\n[[figure:{len(figures)}]]\n"

    cleaned = CHART_FENCE.sub(_replace, report_md)
    if figures:
        print(f"[ARGUS] report figures extracted: {len(figures)} valid spec(s)")
    return cleaned.strip(), figures


def _format_value(value: float) -> str:
    if value == int(value) and abs(value) < 1e15:
        return f"{int(value):,}"
    return f"{value:,.2f}"


def figure_fallback_lines(spec: dict) -> list[str]:
    """The chart's data as plain text — what exporters print when PNG
    rendering is unavailable. The numbers still reach the reader."""
    lines = [f"{spec['title']}:"]
    lines += [f"  - {label}: {_format_value(value)}"
              for label, value in zip(spec["labels"], spec["values"])]
    return lines


def render_figure_png(spec: dict) -> bytes | None:
    """One validated spec → PNG bytes for the .docx/.pdf exports, or None on
    any failure (caller falls back to figure_fallback_lines). matplotlib is
    imported lazily: the memory cost lands only on download requests."""
    try:
        import io

        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        labels, values = spec["labels"], spec["values"]
        fig, ax = plt.subplots(figsize=(6.4, 3.4), dpi=120)
        fig.patch.set_facecolor("#ffffff")
        ax.set_facecolor("#ffffff")

        if spec["type"] == "bar":
            positions = range(len(values))
            ax.bar(positions, values, width=0.6, color=_ACCENT, zorder=3)
            # Value on every cap: this is a STATIC report figure (no tooltip
            # channel exists in a .docx), so caps carry the exact numbers; ink
            # color, never the series color.
            for x, value in zip(positions, values):
                ax.annotate(_format_value(value), (x, value), ha="center",
                            va="bottom", fontsize=8, color=_INK_SECONDARY,
                            xytext=(0, 2), textcoords="offset points")
            ax.set_xticks(list(positions), labels)
        else:  # line
            positions = list(range(len(values)))
            ax.plot(positions, values, color=_ACCENT, linewidth=2,
                    solid_capstyle="round", solid_joinstyle="round", zorder=3)
            # End marker with a surface ring; endpoint gets the direct label.
            ax.plot(positions[-1], values[-1], marker="o", markersize=7,
                    color=_ACCENT, markeredgecolor="#ffffff",
                    markeredgewidth=2, zorder=4)
            ax.annotate(_format_value(values[-1]), (positions[-1], values[-1]),
                        ha="left", va="center", fontsize=8, color=_INK_SECONDARY,
                        xytext=(6, 0), textcoords="offset points")
            ax.set_xticks(positions, labels)

        # Recessive chrome: hairline solid horizontal grid only, baseline-only
        # spines, muted tick labels (dataviz skill specs).
        ax.grid(axis="y", color=_GRIDLINE, linewidth=0.8, zorder=0)
        ax.set_axisbelow(True)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(_BASELINE)
        ax.tick_params(colors=_INK_MUTED, labelsize=8, length=0)
        longest = max(len(str(label)) for label in labels)
        if longest > 8 or len(labels) > 6:
            plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
        if spec.get("y_label"):
            ax.set_ylabel(spec["y_label"], fontsize=8, color=_INK_MUTED)
        # Single series: no legend box — the title names the data.
        ax.set_title(spec["title"], loc="left", fontsize=10, color=_INK,
                     fontweight="semibold", pad=10)

        fig.tight_layout()
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", facecolor="#ffffff")
        plt.close(fig)
        return buffer.getvalue()
    except Exception as render_err:
        print(f"[ARGUS] figure render failed (falling back to text): {render_err!r}")
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except Exception:
            pass
        return None
