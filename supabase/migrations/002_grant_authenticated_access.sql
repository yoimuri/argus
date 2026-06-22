-- "Automatically expose new tables" is disabled on this project, so grants are
-- explicit, not automatic. anon gets nothing (ARGUS has no public/anon use case).
-- authenticated gets table-level access; RLS policies from 001 then filter rows.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.collections to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select, insert, update, delete on public.document_chunks to authenticated;
grant select, insert, update, delete on public.research_sessions to authenticated;
