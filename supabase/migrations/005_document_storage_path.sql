-- The upload handler (backend/main.py) receives the Supabase Storage path for
-- each uploaded PDF but never persisted it — only `filename` was stored. Without
-- the actual storage path, deleting a document/collection can only clear DB rows;
-- the uploaded PDF file itself would be orphaned in Storage forever, which is not
-- true erasure (see ADR-013). This column lets DELETE /collections/{id} purge the
-- underlying Storage object too.

alter table documents add column if not exists storage_path text;
