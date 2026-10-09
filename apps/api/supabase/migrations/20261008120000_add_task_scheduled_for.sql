-- Caught while building the container/task routes: `scheduledFor` on
-- MockTask (mockV2.ts) — which day a task is actually planned for, used
-- throughout Live Board's crew view and AssignWorkDialog — was missed
-- entirely from the original schema. Added here rather than editing the
-- already-applied init migration, since `supabase db push` tracks applied
-- migrations by filename and wouldn't re-run an edited one.
alter table public.tasks add column scheduled_for text;
