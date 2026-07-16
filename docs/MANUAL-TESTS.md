# Manual test guide

Plain step-by-step checks for things a security gate doesn't cover (speed, UI,
session behavior). Work through these live on the deployed app and tick them off.
Newest batch on top.

---

## 2026-07-16 — Void diagnosed + stacking fix + brand surfaces pinned (Fable)

The "black void instead of the animation" got root-caused WITH real-browser
screenshots this time. Two separate things were true: (a) the live deployed
site actually renders the full network (verified against the real production
URL with painted-pixel counts — your void screenshot most likely caught a
mid-deploy CDN moment minutes after your push, serving mixed old/new files;
it self-heals), and (b) there WAS a real latent bug: with a stored LIGHT
theme preference, the new stage background painted OVER the animation
(negative z-index burial — fixed with CSS `isolate` stacking contexts).
Also per your rule: the LANDING and LOGIN are now permanently cinematic dark
(the toggle is gone from the landing header entirely; theme choice lives in
the app for reading comfort). No migration.

**T23 — Two theme CHARACTERS, not just recolors (2026-07-17).**
- The two themes now behave differently, not just look different in color:
- **DARK = "The Watchtower" (surveillance).** Look at the landing hero:
  - links are STRAIGHT (sharp, circuit-like)
  - a radar sweep crosses, and as it passes it briefly snaps a small TARGETING
    BRACKET (corner marks) around occasional nodes — the system "locking on"
  - every so often a bright dot RACES ALONG a link — a data pulse
  - Feels: precise, watchful, technical.
- **LIGHT = "The Reading Room" (organic).** Switch the dashboard to light:
  - links are CURVED (soft woven arcs, not straight wire)
  - nodes gently FLOAT/bob, and the whole field slowly BREATHES (swells)
  - no radar, no brackets, no pulses — nothing is being hunted
  - Feels: calm, flowing, human.
- The test: put them side by side. They should read as two different creatures
  (one scans and locks, one drifts and weaves), NOT the same network recolored.
  (Landing + login are pinned dark, so the light character shows in the dashboard.)
- Note: the dark watch behaviors (radar/brackets/pulses) are deliberately on the
  landing hero ONLY and kept subtle — inside the dashboard the network is calm so
  it never competes with your work.

**T22 — [FORCED MOTION] The animation moves for everyone, including on your PC (2026-07-17).**
- Context: THE reason your PC showed a blank page while your phone worked was
  your Windows reduced-motion setting (Settings → Accessibility → Visual effects
  → Animation effects OFF), which the old code turned into a blank canvas.
  DECISION (yours): the animation now plays for EVERYONE regardless of that
  setting — same design for all users, no motion toggle.
- Steps: open the deployed landing page on your PC WITHOUT changing any Windows
  setting (leave animations however they are).
- Expected: the network drifts and pulses, the aurora glows drift, the radar
  sweeps — full motion, even though your Windows has animations off. It should
  never be a blank or frozen page.
- Note (honest): this deliberately overrides the OS reduced-motion preference.
  The motion is kept gentle (slow drift, soft pulse, no flashing) so it's not a
  hazard, but be aware some visitors set that preference for medical reasons —
  this is a deliberate design choice, documented in CONTINUITY/PHASE4.

**T21 — The animation is actually BOLD, not a faint whisper (2026-07-17).**
- Steps: with Windows animations ON, open the landing page on the deployed site.
- Expected on the HERO: a dense, clearly visible cyan node network edge to
  edge; a radar sweep you can watch cross the upper-right; a soft central glow
  behind the headline; the "Try ARGUS" button visibly glowing. It should read
  as a designed, animated background within one second — not a plain dark page.
- Expected on LOGIN + DASHBOARD: the same network, calmer (fewer nodes, softer,
  no radar) — clearly present in the space around the cards, but never fighting
  the content. A non-technical visitor should feel "this is a real product."

**T19 — The landing/login can never be un-cinematic again.**
- Steps: on the deployed site, sign in, switch the theme to LIGHT in the
  dashboard, sign out, and open the landing page and login page.
- Expected: BOTH are still the full dark cinematic experience (network, radar
  on the landing hero, aurora, glow CTA) even though your app preference is
  light. The dashboard respects your light choice; the brand surfaces don't.
- Also: the landing header no longer shows the Light/Dark/System toggle at
  all. It's in the dashboard (profile menu / settings) only.

**T20 — [RESOLVED 2026-07-17] The "void" was faintness, not a driver issue.**
Your chrome://gpu dump confirmed canvas is hardware-accelerated on your machine,
so this was never a GPU problem. The animation was rendering fine — it was just
tuned to ~7% opacity, i.e. technically visible but effectively invisible. Fixed
in the v3 visibility rebuild (see T21). Kept here for the record; the
chrome://gpu step below is only relevant if a FUTURE change ever regresses to a
truly blank canvas.
1. Wait 2-3 minutes after any push (Vercel mid-deploy can serve mixed files),
   then hard-refresh (Ctrl+Shift+R).
2. If it's a genuine blank canvas (not just faint): open chrome://gpu and look
   for "Canvas: Software only" or driver warnings. Tell me what it said.

## 2026-07-15 — Dark-cinematic rebuild (Fable)

**T18 — The app is dark, cinematic, and unmistakably different.**
- Steps: push, wait for Vercel to finish, then open the landing page in a
  fresh browser profile or private window (important: a normal window may
  keep your old saved theme; private = what a new visitor gets).
- Expected, landing page: the page is DARK by default — a deep blue-black
  base with soft cyan glows drifting slowly behind the hero (the "video-like"
  layer), a dense field of glowing connected dots with a slow radar sweep in
  the upper right, and the network visibly reaching toward your mouse as you
  move it. The headline is much bigger, its second line carries a cyan
  gradient, and the "Try ARGUS" button has a soft neon glow.
- Expected, signed in: every dashboard page is dark with the same living
  network clearly visible behind the content (not the invisible version from
  before), cards read as lit panels with a bright top edge, and the active
  nav item is a filled glowing pill.
- Theme toggle: switching to Light in Settings/profile menu still works and
  looks clean (the animation dims to suit the light page). Your choice
  sticks after reload.
- Reduced-motion check: with OS "reduce motion" on, everything freezes to a
  still frame (dots visible, no drift, no sweep, no aurora movement).
- If it fails: if any page is still light by default in a private window, or
  the background is still barely visible, screenshot it and tell me which
  page + browser.

## 2026-07-15 — Report-gate bug fix + shell/animated-background pass (Sonnet)

**T16 — "Generate report" is truly blocked with no output (bug fix).**
- Steps: (a) create a brand new collection, upload a PDF, wait for it to say
  ready, but do NOT ask any question. Try Generate report.
  (b) In a collection, click Ask, then immediately click Cancel before it
  finishes. Try Generate report right after.
- Expected in BOTH cases: the "Generate report" button is disabled (greyed
  out) with a specific hint text explaining why ("Ask at least one question in
  this collection first…"). It should NOT be clickable, and clicking it
  should NOT be possible. (c) Now actually ask a question and let it finish.
  The button should unlock immediately, no page refresh needed.
- If it fails: if a report generates without ever completing a question in
  that collection, or right after a cancel, tell me exactly which collection
  and what you clicked, in order.

**T17 — The animated background.**
- Steps: open the landing page (signed out). Then sign in and look at any
  dashboard page. Then sign out and look at the login page.
- Expected: a slow, subtle network of glowing connected dots drifts in the
  background on every page. The landing page's version is the richest (denser,
  plus a slow rotating radar-style sweep in one corner); the dashboard/login
  version is calmer and sparser. Text stays fully readable everywhere (the
  animation sits behind cards and content, never on top of it). It should
  never feel distracting or slow down scrolling/typing.
- Reduced-motion check: turn on your OS "reduce motion" setting and reload.
  The background should freeze as a single still frame (nodes visible, no
  drifting or sweeping), not disappear and not keep moving.
- If it fails: if it looks choppy, doesn't appear at all, or the page feels
  slower/janky with it on, tell me which page and what device/browser.

---

## 2026-07-14 — Sprint 4.7 presentability (Opus)

The visual overhaul + motion + How-to guide + interactive tour + charts-in-Ask +
"Generate another version". All 🟡 code-complete, not yet live-verified. No
migration. Push first, then work through these.

**T9 — The app feels alive (motion).**
- Steps: click between Dashboard, Workspace, Sessions, Reports, SOC.
- Expected: page content gently rises/fades in on each load (fast, ~0.3s). The
  dashboard count cards and their icons animate in one after another (a slight
  stagger), and hovering a card lifts it a touch. Nothing janky, nothing slow.
- Reduced-motion check: turn on your OS "reduce motion" setting and reload. The
  content should just appear instantly with no animation, still fully readable.

**T10 — The How-to page (#6).**
- Steps: there's a new "How to" item in the top nav. Open it.
- Expected: a step-by-step guide, one card per feature (ask a question, generate a
  report, sessions, SOC, settings), each with numbered steps in plain language. A
  green highlighted card at the top invites you to take the tour. Near the bottom,
  three copy-paste prompts for the assistant with Copy buttons.

**T11 — The interactive tour (#6).**
- Steps: on the How-to page, click "Take the interactive tour".
- Expected: the screen dims and a spotlight ring highlights ONE real nav item at a
  time (Workspace, then Sessions, Reports, SOC, then the chat button), with a
  tooltip explaining each. Next / Back work, the arrow keys work, clicking the dim
  advances, and the X or Esc closes it. It points at the ACTUAL app, not a picture.

**T12 — Charts inside an Ask answer (#2 / #3).**
- Steps: ask a question whose answer involves a few numbers from your docs, e.g.
  "What share of breaches does each cause represent?" on the DBIR.
- Expected: the answer can now include a REAL bar/line chart (same clean style as
  reports), not ASCII art and not "I can't display it". Ask something with no
  numbers and you should get plain text, no chart. The charted numbers must match
  the source (invented numbers = a problem to tell me about).

**T13 — Generate another version (#5, the safe half).**
- Steps: open a completed report that was made from a collection. Click "Generate
  another version".
- Expected: it starts a NEW report from the same collection (a fresh take) and
  takes you to it. The original report is still there, untouched. (A report made
  from a session answer won't show this button, that's expected.)
- Note: the fuller "revise this draft with a note, using the old one as
  reference" is deliberately NOT built yet, it's an injection-sensitive feature
  getting its own careful pass.

**T14 — The assistant knows the new stuff (#2).**
- Steps: open the chat, ask "how do I start?" or "how do I generate a report?".
- Expected: it gives clear numbered steps and points you to the How-to page /
  tour. Ask "can reports have charts?" and it should say yes, from your numbers.

**T15 — Login polish + everything still works.**
- Steps: sign out, open the login page.
- Expected: a small ARGUS brand mark (eye icon) above the title, the card eases in,
  and Google + email login still work exactly as before.

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
