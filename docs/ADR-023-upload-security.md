# ADR-023: Upload-path security — threat model, audit result, and hardening

**Status:** Accepted, 2026-07-14
**Context:** Owner question (Clint, 2026-07-13): *"Does uploading a PHP file penetrate my server
by running a shell command there? How secure is my file upload, beyond prompt injection?"* This
ADR is the written answer: what the upload path actually does with a file, what was audited, what
was hardened in fix batch #3, and — per the project's honesty rule — the residual risks that
remain and who owns them.

---

## 1. The question answered directly: can an uploaded `.php` run on the server?

**No.** Two facts make the classic upload-RCE scenario structurally inapplicable here:

1. **Nothing executes uploaded content, anywhere.** Audited by grepping the entire backend for
   every execution primitive: there is no `subprocess`, `os.system`, `os.popen`, `eval`, `exec`,
   or `shell=True` in the codebase. The backend never shells out at all. An uploaded file is
   *parsed* (by PyMuPDF, as data) — never interpreted, imported, or served for execution.
2. **Uploaded files never land in a web-served directory.** The classic PHP-shell attack works by
   writing a file where a web server executes scripts by path. Here, files go into Supabase
   Storage (an object store — it serves bytes, executes nothing), and the backend's only local
   copy is a `temp_<uuid4>.pdf` scratch file that is parsed and deleted in a `finally` block. The
   FastAPI process on Render serves only its own Python routes; there is no document root to drop
   a shell into.

What happens to a `.php` (or any non-PDF) upload instead: the backend streams it from Storage,
reads the first four bytes, and rejects anything that isn't `%PDF` with a clean 400 before PyMuPDF
ever touches it — and the early-failure path deletes the document row, leaving nothing behind.
The browser-side `accept="application/pdf"` filter is UX only and is *not* trusted; the
server-side magic-byte check and the 25 MB streaming size cap are the real gates.

A **polyglot** file (valid `%PDF` header with, say, PHP appended) passes the magic-byte check —
and that is fine *for this threat*: to us it is only ever a PDF being parsed. Polyglots matter
where a file is later served or executed under a different interpreter; neither happens here.

## 2. What fix batch #3 hardened (defense in depth, not fixes for live holes)

- **Storage-path trust.** `file_path` is client-supplied text that the backend interpolates into
  a Storage URL. Storage RLS is the real authorization boundary, but the handler now also rejects
  any `file_path` that contains `..`, backslashes, or NULs, or that doesn't start with the
  caller's own `user_id/` prefix — a crafted path now dies at the front door (400) instead of
  relying on a second system to stop it.
- **Filename sanitization.** `file_name` is display text that gets stored, listed in the UI, and
  used as a document label in report prompts. It is now stripped of path separators and control
  characters and capped at 200 chars before persisting.
- **PyMuPDF bumped 1.24.7 → 1.26.7.** Verified 2026-07-14: PyMuPDF ≤1.26.6 carries
  **CVE-2026-3029** (path traversal → arbitrary file write). The vulnerable code path is the
  `pymupdf` *CLI's* embedded-file extraction, which this backend does not invoke — but the pin
  was two years of upstream MuPDF parser fixes behind, and this library parses **untrusted PDFs**
  as its day job. Staying current on it is the single most load-bearing patch habit this project
  has.

## 3. Residual risks — stated, not hidden

| Risk | Reality | Mitigation / owner |
|---|---|---|
| **PyMuPDF's C parser on untrusted PDFs** | The one genuine RCE-class surface in the upload path: MuPDF is a large C codebase, and parser bugs in C are memory-corruption bugs. It runs unsandboxed in the API process (a PoC limitation — sandboxing a parser needs container/seccomp machinery the free tier doesn't offer). | Keep PyMuPDF current (this ADR bumps it; recheck on future sprints); 25 MB cap bounds inputs; magic-byte check keeps trivial non-PDFs out. Honest status: mitigated, not eliminated. |
| **Storage-bucket RLS is dashboard-managed** | The policies that stop user A reading/writing user B's objects live in Supabase's dashboard, not in this repo — the repo cannot prove them. | **Clint's manual step (GATE-29):** verify in Supabase → Storage → `documents` bucket → policies that SELECT/INSERT/DELETE are scoped to `(storage.foldername(name))[1] = auth.uid()::text` (or equivalent own-prefix rule), and record the result in ADVERSARIAL-TESTS. |
| **Groq/HF/Tavily receive document text** | Chunk text is sent to external inference APIs — that's the product working as designed, disclosed in ADR-013's privacy posture, not an upload-path defect. | Existing ADR-013 posture; nothing new. |
| **Malicious PDF *content* (prompt injection)** | Out of scope here — covered by the existing injection stack (upload-time regex quarantine, synthesizer-side scan, trust-level framing; ADR-007/012). | Existing controls. |

## 4. Verification

GATE-29 (ADVERSARIAL-TESTS): (a) upload a `.php`/renamed non-PDF → clean 400, no document row
left behind; (b) POST a `file_path` outside your own user prefix (or containing `..`) → 400
before any Storage/DB work; (c) oversize file → 400 at the 25 MB cap; (d) the Storage-RLS
dashboard check above. All against the live app, results recorded pass or fail.
