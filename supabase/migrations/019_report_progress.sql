-- 019_report_progress.sql: Sprint 4.6a fix batch #3 (plan "Report speed").
--
-- A short human-readable stage string the generator updates between model
-- calls ("Reading documents (3/8)…", "Writing the report…"), so the report
-- page's progress bar shows real progress instead of an anonymous spinner.
-- Cosmetic by design: the generator writes it best-effort and the backend
-- falls back cleanly if this migration isn't applied yet (deploy-order
-- safety, same pattern as 018's error_detail).

alter table public.reports
  add column if not exists progress text;
