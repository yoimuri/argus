"""Shared Markdown-line parser for the report exporter (fix batch #3).

Originally shared by the .docx and a fpdf2 PDF exporter; the PDF was removed
2026-07-14, so today only docx_export.py consumes this. It stays a separate
module (rather than folding back into docx_export) because it's the clean seam
where a future exporter would plug in, and it keeps the parser honest and
testable on its own. It understands exactly the constructs the generator's
prompt is allowed to emit (report_generator.py constrains the model):
# ## ### headings, - bullets, 1. numbered items, **bold** inline, plain
paragraphs — plus the [[figure:N]] markers that reference validated chart
specs (Sprint 4.6b, see figures.py). Anything else passes through as literal
paragraph text: an honest simple parser matched to a constrained generator,
not a Markdown engine.
"""
import re

BOLD_SPLIT = re.compile(r"\*\*(.+?)\*\*")
NUMBERED = re.compile(r"^\d+[.)]\s+")
FIGURE_MARKER = re.compile(r"^\[\[figure:(\d+)\]\]$")


def markdown_blocks(report_md: str) -> list[tuple[str, str]]:
    """Walk the report line-by-line into (kind, text) blocks.

    Kinds: 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'figure' | 'para'.
    For 'figure', text is the 1-based figure index as a string (into the
    report's stored figures list). Blank lines are dropped — block spacing is
    the renderer's decision, not the parser's.
    """
    blocks: list[tuple[str, str]] = []
    for raw_line in report_md.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        figure = FIGURE_MARKER.match(line)
        if figure:
            blocks.append(("figure", figure.group(1)))
        elif line.startswith("# "):
            blocks.append(("h1", line[2:].strip()))
        elif line.startswith("## "):
            blocks.append(("h2", line[3:].strip()))
        elif line.startswith("### "):
            blocks.append(("h3", line[4:].strip()))
        elif line.startswith(("- ", "* ")):
            blocks.append(("bullet", line[2:].strip()))
        elif NUMBERED.match(line):
            blocks.append(("number", NUMBERED.sub("", line).strip()))
        else:
            blocks.append(("para", line))
    return blocks
