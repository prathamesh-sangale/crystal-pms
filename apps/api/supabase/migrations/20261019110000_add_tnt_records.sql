-- A permanent record of how long a TnT clock actually took, by direct
-- request -- previously the turnaround-time clock (tnt_started_at/
-- tnt_paused_at/tnt_paused_ms on tasks) was only ever computed live; the
-- moment every task in a clock's group settled, there was nothing left
-- showing what actually happened. One row per clock that finishes: PTI and
-- Repairment each get one clock per section, Painting gets two independent
-- ones (paint_work, logo) -- see mockV2.ts's SECTION_TNT_HRS/PAINT_WORK_KEYS/
-- LOGO_TNT_HRS for the live-side definition this mirrors.
create table public.tnt_records (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.sections(id) on delete cascade,
  clock_key    text not null, -- 'pti' | 'repairment' | 'paint_work' | 'logo'
  target_hrs   numeric not null,
  started_at   timestamptz not null,
  completed_at timestamptz not null,
  elapsed_ms   bigint not null,
  created_at   timestamptz not null default now(),
  -- The idempotency guard: recording the same clock twice (two sibling
  -- tasks in the same group settling in quick succession, each triggering
  -- a check) is a harmless conflict the insert just swallows -- no
  -- read-then-write race to get right by hand.
  unique (section_id, clock_key)
);

alter table public.tnt_records enable row level security;
