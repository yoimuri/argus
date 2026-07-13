-- 020_report_figures.sql: Sprint 4.6b — generated figures (charts) in reports.
--
-- Design (ADR-024): the model emits chart SPECS (labels + numbers found in the
-- documents), never images. Validated specs are stored here as JSON; the
-- report body carries [[figure:N]] markers where each chart belongs. Rendering
-- happens at the edges: the report page draws the charts client-side as SVG
-- (no chart library), and the .docx/.pdf downloads render them server-side as
-- PNGs with matplotlib at export time. Nothing binary is ever stored — a spec
-- is small, auditable, and can't smuggle content the way an opaque image
-- could. Explicitly NOT AI image generation (owner decision, 2026-07-11):
-- charts built from numbers present in the source documents only.

alter table public.reports
  add column if not exists figures jsonb;
