# Manual test guide

Plain step-by-step checks for things a security gate doesn't cover (speed, UI,
session behavior). Work through these live on the deployed app and tick them off.
Newest batch on top.

---

## 2026-07-14 — cleanup batch (Opus)

### Before you start (do these once)

1. **Push** your commit so Render (backend) and Vercel (frontend) rebuild.
2. **Wake the backend**: open the app and do any small action (open Workspace).
   The first request after idle takes 30 to 60 seconds. That is the free tier
   waking up, not a bug. Everything below assumes the server is already awake.
3. **For the report tests only** (T4b, T5, T6): paste migrations **018, 019, 020**
   into the Supabase SQL editor first. Without them, reports still work but the
   progress bar, the figures, and the failure reason fall back to plain versions.

### The tests

**T1 — Faster answers on off-topic questions (#8, the slow-critic fix)**
- Steps: pick a collection, Ask a broad question your documents do NOT really
  answer, e.g. "What are the most common causes of breach?"
- Expected: you get the answer in ONE pass, noticeably faster than before. It may
  still say "Low confidence" (that is correct, it means the answer is not backed
  by your documents). Open the session's Execution trace: you should see the
  agents run once each (orchestrator, retriever, synthesizer, critic, reporter),
  NOT a second retriever/synthesizer/critic pass.
- If it fails: if you still see the pipeline run twice and take 30+ seconds on a
  question your docs can't answer, the retry is still firing. Tell me.

**T2 — You stay logged in while actively using the app (#7)**
- Steps: open a report or any page and keep using the app (scroll, move the mouse,
  type) for a bit over 30 minutes without ever getting logged out. You don't have
  to stare at it the whole time, just interact now and then past the 30-minute mark.
- Expected: you are NOT bounced to login. Your next click keeps working.
- If it fails: if you get kicked to login while actively clicking around, the
  keep-alive isn't firing. Tell me.

**T3 — The session still times out when you actually walk away (#7)**
- Steps: log in, then leave the tab completely alone (no clicks, no mouse, no
  scroll) for 30+ minutes. Come back and click something.
- Expected: you ARE sent to login (with "signed out due to inactivity"). This
  proves the keep-alive didn't defeat the security timeout, it only ignores real
  activity.
- If it fails: if you can walk away for an hour and still be logged in, the timer
  is broken. Tell me.

**T4a — Reports download only as .docx (#3, PDF removed)**
- Steps: open a completed report.
- Expected: there is a single "Download .docx" button and a Delete button. No
  "Download PDF" or "Save as PDF" anywhere. The .docx opens in Word/LibreOffice
  with headings and lists intact, and you can edit it.
- If it fails: if any PDF button is still there, it didn't deploy. Hard-refresh,
  then tell me.

**T4b — Report figures still land in the .docx (#3 didn't break figures)**
- Steps: generate a report on a collection that has real numbers (e.g. the DBIR),
  then download the .docx.
- Expected: any charts show in the preview AND are embedded as images in the .docx.
  (Needs migration 020 pasted.)

**T5 — The Generate-report popup (#4)**
- Steps: in the Workspace, on a collection that HAS uploaded documents, click the
  single "Generate report" button.
- Expected: a popup opens explaining Quick draft vs Full report, with a button for
  each and the large-collection note. Picking one starts generation. On a
  collection with NO documents, the "Generate report" button is disabled and shows
  a short hint to upload a PDF first.
- If it fails: if you still see the old "Generate a report" heading with two
  always-visible buttons, it didn't deploy.

**T6 — Large-file honesty (#4)**
- Steps: run a Full report on a large collection (many long PDFs).
- Expected: the finished report includes a line saying it read a representative
  sample, not every page (it no longer pretends to have read everything). A Quick
  draft on a big collection says the same.

**T7 — No em dashes in the app text (#5)**
- Steps: read the chatbot's opening greeting, the dashboard welcome text, the SOC
  page intro, the report disclaimer, and the report popup.
- Expected: none of them use the long "—" dash mid-sentence. They read like normal
  writing (commas, periods).
- If it fails: if you spot a "—" in text you READ on screen (not in a tooltip),
  note where and tell me.

**T8 — The landing button tells the truth (#1)**
- Steps: (a) while logged OUT, open the landing page: the button says "Sign in".
  (b) while logged IN and active, it says "Go to dashboard" and takes you there.
  (c) the bug case: log in, leave the tab idle 30+ minutes so the session expires,
  then open/refresh the landing page.
- Expected in (c): the button now says "Sign in" (not "Go to dashboard"), because
  it knows your session has idled out. Clicking it goes to login cleanly.
- If it fails: if an idle-expired session still shows "Go to dashboard" and bounces
  you on click, the status check isn't working. Tell me.

### Still your manual steps from earlier batches (not retested here)
- Paste migrations 018, 019, 020 (needed for T4b, T5, T6 to be fully visible).
- Verify the `documents` Storage bucket RLS (GATE-29d, policy text in ADR-023).
- The security gates GATE-28 / 29 / 30 in `docs/ADVERSARIAL-TESTS.md`.
