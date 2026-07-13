"""Fix batch #3 — Markdown report → real PDF bytes, via fpdf2 (2.8.7).

Replaces the "Save as PDF opens the print dialog" flow with a genuine
Download-PDF file, generated server-side. fpdf2 is pure-Python (Pillow /
fonttools / defusedxml underneath — no system packages), imported lazily by
main.py's download endpoint. The layout mirrors the .docx: title, colored
disclaimer, the shared markdown_blocks() structure, embedded figure PNGs
(4.6b), and the generated-note footer — one parser, two renderers.

Honest limitation, stated: fpdf2's built-in core fonts (Helvetica) are
latin-1 only. Rather than shipping a ~750KB TTF in the repo for full Unicode,
_latin1() transliterates the typographic characters the model actually emits
(curly quotes, en/em dashes, bullets, ellipses) and substitutes '?' for
anything else. Fine for a proofread-me draft; revisit with an embedded font
if reports ever need full Unicode fidelity.
"""
import io

from fpdf import FPDF

from app.services.report_markdown import markdown_blocks

# Colors (RGB): disclaimer in the same dark amber as the .docx; chrome/ink
# from the design system's light set (a PDF page is always white).
_DISCLAIMER_RGB = (0x92, 0x5A, 0x0A)
_INK_RGB = (0x0B, 0x0B, 0x0B)
_SECONDARY_RGB = (0x52, 0x51, 0x4E)
_MUTED_RGB = (0x89, 0x87, 0x81)

_TRANSLITERATE = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": " - ", "…": "...", "•": "-",
    " ": " ", "‑": "-", "′": "'", "″": '"',
    "⚠": "!",  # ⚠ has no latin-1 form; the disclaimer still leads with "!"
}


def _latin1(text: str) -> str:
    for source, replacement in _TRANSLITERATE.items():
        text = text.replace(source, replacement)
    return text.encode("latin-1", "replace").decode("latin-1")


def markdown_report_to_pdf(report_md: str, title: str, disclaimer: str,
                           generated_note: str, figures: list[dict] | None = None) -> bytes:
    from app.services.figures import figure_fallback_lines, render_figure_png

    figures = figures or []
    pdf = FPDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(left=18, top=18, right=18)
    pdf.add_page()

    # Title + disclaimer (same order and emphasis as the .docx).
    pdf.set_font("helvetica", style="B", size=17)
    pdf.set_text_color(*_INK_RGB)
    pdf.multi_cell(0, 8, _latin1(title))
    pdf.ln(1)
    pdf.set_font("helvetica", style="I", size=9)
    pdf.set_text_color(*_DISCLAIMER_RGB)
    pdf.multi_cell(0, 4.6, _latin1(f"! {disclaimer}"))
    pdf.ln(3)

    first_heading_skipped = False
    number_counter = 0
    for kind, text in markdown_blocks(report_md):
        if kind != "number":
            number_counter = 0

        if kind == "h1":
            if not first_heading_skipped:
                first_heading_skipped = True
                continue
            kind = "h2"  # any later top-level heading renders like a section

        if kind == "h2":
            pdf.ln(3)
            pdf.set_font("helvetica", style="B", size=13)
            pdf.set_text_color(*_INK_RGB)
            pdf.multi_cell(0, 6.5, _latin1(text))
            pdf.ln(1)
        elif kind == "h3":
            pdf.ln(2)
            pdf.set_font("helvetica", style="B", size=11)
            pdf.set_text_color(*_INK_RGB)
            pdf.multi_cell(0, 5.6, _latin1(text))
        elif kind == "bullet":
            pdf.set_font("helvetica", size=10.5)
            pdf.set_text_color(*_SECONDARY_RGB)
            # markdown=True renders the **bold** runs the generator may emit.
            pdf.set_x(pdf.l_margin + 4)
            pdf.multi_cell(0, 5.2, _latin1(f"- {text}"), markdown=True)
        elif kind == "number":
            number_counter += 1
            pdf.set_font("helvetica", size=10.5)
            pdf.set_text_color(*_SECONDARY_RGB)
            pdf.set_x(pdf.l_margin + 4)
            pdf.multi_cell(0, 5.2, _latin1(f"{number_counter}. {text}"), markdown=True)
        elif kind == "figure":
            index = int(text) - 1
            if not (0 <= index < len(figures)):
                continue
            spec = figures[index]
            png = render_figure_png(spec)
            if png:
                pdf.ln(2)
                # 6.4x3.4in chart on a 174mm text column: full width keeps the
                # 120dpi render crisp.
                pdf.image(io.BytesIO(png), w=pdf.epw)
                pdf.set_font("helvetica", style="I", size=8.5)
                pdf.set_text_color(*_MUTED_RGB)
                pdf.multi_cell(0, 4.2, _latin1(f"Figure: {spec['title']}"))
                pdf.ln(2)
            else:
                pdf.set_font("helvetica", size=10)
                pdf.set_text_color(*_SECONDARY_RGB)
                for line in figure_fallback_lines(spec):
                    pdf.multi_cell(0, 5, _latin1(line))
        else:  # para
            pdf.set_font("helvetica", size=10.5)
            pdf.set_text_color(*_SECONDARY_RGB)
            pdf.multi_cell(0, 5.2, _latin1(text), markdown=True)
            pdf.ln(1)

    pdf.ln(4)
    pdf.set_font("helvetica", style="I", size=8.5)
    pdf.set_text_color(*_MUTED_RGB)
    pdf.multi_cell(0, 4.2, _latin1(generated_note))

    return bytes(pdf.output())
