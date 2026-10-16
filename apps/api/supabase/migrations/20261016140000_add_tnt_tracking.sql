-- Turnaround-time (TnT) tracking, by direct request: PTI/Painting/
-- Repairment each get a target number of hours, and a yard-wide
-- electricity outage can pause (Painting/Cleaning/Repairment) or reset
-- (PTI) the clock. Deliberately separate from elapsed_sec/started_at/
-- completed_at -- this never touches a task's actual logged work time,
-- only this new clock used purely to flag "running over target."

alter table public.tasks
  add column tnt_started_at timestamptz not null default now(),
  add column tnt_paused_at  timestamptz,
  add column tnt_paused_ms  bigint not null default 0;

-- A bare `default now()` would make every already-existing task look like
-- it just started, understating how long it's actually been open. Every row
-- just got that default (the column didn't exist a moment ago), so this
-- backfills all of them from the same baseline agingDays() already uses:
-- the task's own started_at if it has one, else the container's survey
-- date, else its registered_at.
update public.tasks t
set tnt_started_at = coalesce(
  t.started_at,
  (select c.survey_performed_at from public.containers c
     join public.sections s on s.container_id = c.id
     where s.id = t.section_id),
  (select c.registered_at from public.containers c
     join public.sections s on s.container_id = c.id
     where s.id = t.section_id)
);

-- One row, always -- the yard either is or isn't currently in an outage.
-- id is a boolean fixed to true so a second insert can never happen.
create table public.yard_power_status (
  id         boolean primary key default true,
  is_down    boolean not null default false,
  changed_at timestamptz not null default now(),
  constraint yard_power_status_single_row check (id)
);
insert into public.yard_power_status (id, is_down) values (true, false);

alter table public.yard_power_status enable row level security;
