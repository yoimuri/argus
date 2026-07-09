-- Adds browser/OS context to security_events, prompted by Clint asking whether
-- the SOC feed had enough forensic detail (2026-07-09). IP address and a
-- tamper-evident (service-key) write path stay deferred to Phase 4b — see
-- migration 004's INTEGRITY CAVEAT and docs/ADR-018.md Part 3 — but the raw
-- User-Agent header is cheap to capture, carries no write-path trust problem,
-- and is immediately useful context on the feed. Idempotent, safe to re-run.

alter table security_events add column if not exists user_agent text;
