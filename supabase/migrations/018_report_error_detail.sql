-- 018_report_error_detail.sql: Sprint 4.6a fix batch #2 (2026-07-13, ADR-022
-- revision 2). A failed report row previously said only status='error' — the
-- UI could not tell the user WHY (rate limit? provider outage? interrupted
-- run?), which made the live rate-limit failures look like random breakage.
-- One nullable column; the backend writes a short user-safe sentence
-- (report_generator._describe_failure), the report page shows it. No RLS or
-- grant changes needed — reports' existing own-row policies cover the column.

alter table public.reports
  add column if not exists error_detail text;
