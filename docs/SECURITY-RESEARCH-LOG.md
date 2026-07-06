# Security Research Log

Dated entries. Each one: what was checked, what was found, and an honest applicability
verdict for ARGUS specifically, not a generic "this exists, be scared" note. This is
different from the ADRs (decisions made) and ADVERSARIAL-TESTS.md (attacks actually run
against the live app), this file is what came from checking the current external threat
landscape against ARGUS's real code.

---

## July 5, 2026

Triggered by a third-party pentest scan plus a direct request to check for anything the
build might have missed. Findings below, each checked against ARGUS's actual code, not
assumed from the CVE title alone.

### Dependency audit, run for real

`BLUEPRINT.md`'s LLM03 mitigation always listed `pip-audit` and `npm audit`, neither had
actually been run before today.

- `pip-audit -r backend/requirements.txt`: **no known vulnerabilities found.**
- `npm audit` (frontend): one moderate finding, PostCSS < 8.5.10, XSS via unescaped
  `</style>` in CSS stringification (GHSA-qx2v-qp2m-jg93), pulled in transitively through
  Next.js. Confirmed the suggested `npm audit fix --force` is wrong, it would install
  `next@9.3.3`, an unrelated ancient major version, not a real fix. Tested bumping to the
  latest stable patch (16.2.10) directly, audit still flagged it, no stable Next.js release
  currently ships a fixed PostCSS, only unreleased canary builds do.
  **Verdict: tracked, not fixed.** No safe upgrade path exists yet. Likely low actual risk
  for ARGUS specifically, PostCSS runs at build time over static Tailwind/CSS source,
  nothing in the app generates CSS from document content or user queries, so the
  attacker-controlled-content precondition for this XSS doesn't appear reachable. Re-check
  when Next.js ships a stable release past 16.3.0.

### LangGraph/LangChain CVEs (CVE-2025-67644, CVE-2026-28277, CVE-2026-27022, CVE-2026-34070)

Real, serious, actively discussed CVEs in the LangGraph/LangChain ecosystem this year,
SQL injection and deserialization RCE in the SQLite/Redis checkpointer persistence layer,
and path traversal in LangChain-core's prompt-loading API.
**Verdict: not applicable to ARGUS's current build, confirmed by reading `graph.py`
directly.** `builder.compile()` is called with no `checkpointer` argument at all, ARGUS's
LangGraph usage is fully stateless between requests, there is no SQLite or Redis
checkpointer configured, so the vulnerable persistence layer doesn't exist in this
deployment. `pip-audit`'s clean result independently corroborates this, the separate
checkpointer packages (`langgraph-checkpoint-sqlite`, `langgraph-checkpoint-redis`) aren't
even installed. The prompt-loading CVE doesn't apply either, ARGUS's system prompts are
hardcoded Python strings, never loaded via `load_prompt()` from an external file.
**Re-check this the moment a checkpointer ever gets added** (Phase 3's re-retrieval loop
or any future multi-turn/resumable session feature would be the trigger).

### OWASP LLM Top 10, 2026 update

The 2025 categories `BLUEPRINT.md` cites (LLM01-LLM10) are still current, confirmed, not
stale. The 2026 update's headline addition is explicit coverage of **multimodal injection**,
images, PDFs, and audio carrying malicious instructions, described as "a problem that
text-only defenses cannot solve."
**Verdict: not an active gap today, but a real forward-flag.** ARGUS's injection defenses
(Lock #1, Lock #2, the query-text guard) all operate on extracted text only. This is fine
right now because PyMuPDF's text-only extraction means ARGUS literally cannot process
images or figures at all, that's already a documented permanent limitation. But if
image/figure reading is ever added later (a vision model for figures, for example), the
current text-based injection guards would not automatically extend to cover that channel,
it would need its own explicit defense, not an assumption that Lock #1/#2 already cover it.

### MCP security, forward-pointer for Sprint 2.5 / Phase 5

The NSA issued a Cybersecurity Information Sheet on MCP security in May 2026, and a
"MCP-38" taxonomy of MCP-specific risk categories exists (auth bypass, privilege
escalation, tool description manipulation). No action needed now, Sprint 2.5 is allowlist
logic only, no real MCP server exists yet. **Check this guidance specifically when Phase
5's actual MCP server gets built**, not before, it isn't actionable against code that
doesn't exist yet.
