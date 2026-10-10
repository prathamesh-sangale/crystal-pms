-- Client request: Sailing Crew gets real assignable work (loading,
-- unloading, shifting, container list) for the first time -- it needs its
-- own section kind, distinct from all_rounder/Repairment, since it's
-- unrelated work done by a different crew.
-- "sections_kind_check" is Postgres's default auto-generated name for the
-- unnamed inline check on sections.kind from the original migration.
alter table public.sections drop constraint if exists sections_kind_check;
alter table public.sections add constraint sections_kind_check
  check (kind in ('painting', 'pti', 'cleaning', 'all_rounder', 'sailing'));
