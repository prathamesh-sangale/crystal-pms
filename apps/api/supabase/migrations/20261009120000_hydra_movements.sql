-- Hydra — a standalone container/equipment movement log (loading, unloading,
-- shifting), explicitly independent of the readiness workflow's own
-- containers/sections/tasks tables. Its own Type list is wider than the
-- main app's TYPE_CODES (includes Machine/Other) by direct instruction —
-- Hydra tracks different things than the depot's own reefer intake does,
-- so it gets its own list rather than inheriting the trimmed one.
create table public.hydra_movements (
  id             uuid primary key default gen_random_uuid(),
  movement_date  date not null,
  container_no   text not null,
  type           text not null,
  size           text not null,
  movement_type  text not null check (movement_type in ('Loading', 'Unloading', 'Shifting')),
  -- Null for Shifting — the form disables and clears this field when
  -- Movement Type is Shifting, same rule enforced here as a backstop.
  direction      text check (direction in ('IN', 'OUT')),
  file_id        text,
  file_url       text,
  logged_by      text,
  created_at     timestamptz not null default now()
);

create index idx_hydra_movements_date on public.hydra_movements(movement_date);

alter table public.hydra_movements enable row level security;
