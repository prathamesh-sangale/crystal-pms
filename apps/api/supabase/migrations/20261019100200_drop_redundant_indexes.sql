-- Both redundant with an index Postgres already built for an existing
-- unique constraint -- a composite index on (container_id, kind) /
-- (section_id, key) already serves a lookup filtered on just the leading
-- column (container_id alone / section_id alone), by the standard
-- leftmost-prefix rule, so these single-column copies were never buying
-- anything. Flagged in the 2026-10-10 security audit, left alone at the
-- time since the impact at this app's data volume is negligible -- dropped
-- now while touching the schema for other reasons anyway.
drop index if exists public.idx_sections_container_id;
drop index if exists public.idx_tasks_section_id;
