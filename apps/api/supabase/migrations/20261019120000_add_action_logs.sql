-- Developer-only action log, by direct request: every mutating request the
-- API handles gets one row here, regardless of which route it hit or
-- whether it succeeded -- a rejected 401/403 attempt is logged too, not
-- just successful actions. Written by one global hook (apps/api/src/app.ts),
-- not hand-added per route, so a new route can't be accidentally left
-- unlogged. Read only through /api/dev/logs, a route gated by its own
-- separate password -- nothing to do with the app's normal users/sessions.
create table public.action_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  method      text not null,
  path        text not null,
  category    text not null,
  status_code integer not null,
  user_id     text,
  user_email  text,
  user_role   text,
  -- Known-sensitive keys (password, currentPassword, newPassword) are
  -- redacted before this is ever written -- see app.ts's logging hook.
  body        jsonb,
  query       jsonb,
  ip          text
);

create index idx_action_logs_created_at on public.action_logs(created_at desc);
create index idx_action_logs_category on public.action_logs(category);

alter table public.action_logs enable row level security;
