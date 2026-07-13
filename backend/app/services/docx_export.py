"""Sprint 4.6a (D17) — Markdown report → .docx bytes, via python-docx.

The deliverable layer is the product (PHASE4's value-proposition framing): a
real downloadable file, not chat text to copy-paste. python-docx is the one
approved new dependency (small, pure-Python, its lxml wheel is a few MB —
fine on the 512 MB dyno). Imported lazily by main.py's download endpoint so
it costs nothing on every other request.

The converter handles exactly the Markdown the reduce prompt is allowed to
emit (report_generator.py constrains it): # ## ### headings, - bullets,
1. numbered lists, **bold** inline, plain paragraphs. Anything else passes
through as literal text — an honest simple converter, not a Markdown engine.
"""
import io
import re

from docx import Document
from docx.shared import Pt, RGBColor

# Dark amber, readable on the white page — the disclaimer must be seen, not
# skimmed past (it is part of the design, per the 4.6 owner clarification).
_DISCLAIMER_COLOR = RGBColor(0x92, 0x5A, 0x0A)

_BOLD_SPLIT = re.compile(r"\*\*(.+?)\*\*")
_NUMBERED = re.compile(r"^\d+[.)]\s+")


def _add_runs_with_bold(paragraph, text: str):
    """Split '**bold** rest' into styled runs. Unmatched ** stays literal."""
    pos = 0
    for match in _BOLD_SPLIT.finditer(text):
        if match.start() > pos:
            paragraph.add_run(text[pos:match.start()])
        paragraph.add_run(match.group(1)).bold = True
        pos = match.end()
    if pos < len(text):
        paragraph.add_run(text[pos:])


def markdown_report_to_docx(report_md: str, title: str, disclaimer: str,
                            generated_note: str) -> bytes:
    doc = Document()

    doc.add_heading(title, level=0)

    # Disclaimer directly under the title: italic, colored, unmissable.
    disclaimer_para = doc.add_paragraph()
    run = disclaimer_para.add_run(f"⚠ {disclaimer}")
    run.italic = True
    run.font.size = Pt(10)
    run.font.color.rgb = _DISCLAIMER_COLOR

    first_heading_skipped = False
    for raw_line in report_md.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("# "):
            # The generator opens with a "# title" line that duplicates the
            # document heading above — drop only that first one.
            if not first_heading_skipped:
                first_heading_skipped = True
                continue
            doc.add_heading(line[2:].strip(), level=1)
        elif line.startswith("## "):
            doc.add_heading(line[3:].strip(), level=1)
        elif line.startswith("### "):
            doc.add_heading(line[4:].strip(), level=2)
        elif line.startswith(("- ", "* ")):
            _add_runs_with_bold(doc.add_paragraph(style="List Bullet"), line[2:].strip())
        elif _NUMBERED.match(line):
            _add_runs_with_bold(
                doc.add_paragraph(style="List Number"),
                _NUMBERED.sub("", line).strip(),
            )
        else:
            _add_runs_with_bold(doc.add_paragraph(), line)

    footer = doc.add_paragraph()
    footer_run = footer.add_run(generated_note)
    footer_run.italic = True
    footer_run.font.size = Pt(9)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()
