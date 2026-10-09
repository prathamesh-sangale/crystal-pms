-- ReeferReady PMS — v2 schema (replaces the old single-stage Prisma model).
--
-- Shaped from apps/web/src/lib/mockV2.ts, the data model the current v2 UI
-- actually runs on: parallel sections per container (not one stage at a
-- time), per-task worker assignment, the full Gate In/Gate Out form record
-- (including inspection photos and the PTI video), and resumable intake
-- drafts. The old prisma/schema.prisma model (one `stage`, one technician
-- per container) is left in place untouched until this replacement is wired
-- up and verified end to end.
--
-- Not yet applied to any live database as of writing — safe to edit this
-- file directly rather than stacking a new migration on top, since nothing
-- depends on an earlier version of it yet.
--
-- RLS is enabled everywhere with no permissive policies: apps/api is the only
-- caller, and it always connects with the service_role key, which bypasses
-- RLS entirely. This is defense-in-depth — if the anon/public key ever leaks,
-- it still can't read or write a single row.

create table public.workers (
  id      text primary key,
  name    text not null,
  type    text not null check (type in (
            'painter', 'painter_helper', 'technician', 'all_rounder',
            'cleaner', 'tea_boy', 'sailing_crew'
          )),
  active  boolean not null default true,
  notes   text not null default ''
);

-- The unit number (e.g. 'RFCU 445 129-8') is the natural key — it's unique by
-- definition (ISO 6346) and every screen already keys off it as a string, so
-- introducing a surrogate id would just be a second id nothing uses.
create table public.containers (
  id                  text primary key,
  type_code           text not null,
  size                text not null,
  -- Null until survey has run (reefers default to white then; dry/tank units
  -- carry whatever the customer asked for).
  color               text,
  priority            boolean not null default false,
  registered_at       timestamptz not null default now(),
  -- Where the container physically is right now; null means "at the gate,
  -- not yet moved to a work site." The admin action that used to update
  -- this (a "Move" log) was removed from the UI as unused/half-built —
  -- nothing currently writes a non-null value here except hand-seeded mock
  -- data — but the column stays since Container Detail's header still reads
  -- it, and a real Move action could be reintroduced later without a schema
  -- change.
  current_site        text,
  ready_at            timestamptz,
  -- Set the moment Gate Out is confirmed. Independent of `gate_out` below —
  -- a legacy container can be departed with no digital gate-out record
  -- behind it, so this is the archive flag the rest of the app actually
  -- filters active vs. departed containers on, not gate_out's presence.
  departed_at         timestamptz,
  survey_performed_at timestamptz,
  survey_outcome      text check (survey_outcome in ('ready', 'needs-work')),
  -- [{label, severity, note}], kept as one jsonb blob rather than a child
  -- table: the field list is a fixed-shape snapshot taken at survey time,
  -- never queried or filtered on its own. severity is one of unassessed /
  -- good / minor / major / flagged — `flagged` is the Repair checklist's
  -- plain yes/no outcome, minor/major stay Machine Check's own three-way
  -- grade (see mockV2.ts's FieldSeverity for why the two diverged).
  survey_fields       jsonb not null default '[]'::jsonb,
  -- The full Gate In / Gate Out form submission, each stored whole —
  -- everything from loggedBy/transporter/vehicle down through the nine
  -- required inspection photos and the PTI video, matching GateLogEntry in
  -- mockV2.ts field for field. Same "fixed-shape snapshot, never queried on
  -- one of its own sub-fields" reasoning as survey_fields above: this is
  -- always read and rendered whole (the Gate In/Out record, the printable
  -- container report), never filtered by e.g. just its estBudget. Each
  -- photo/video value is meant to be a real Google Drive file link once
  -- upload is wired up — not the temporary in-browser blob: URL the intake
  -- form uses today, which doesn't survive a page reload.
  gate_in             jsonb,
  gate_out            jsonb
);

-- One row per section a container actually needs — not all four, only the
-- ones the Gate-In survey turned on.
create table public.sections (
  id           uuid primary key default gen_random_uuid(),
  container_id text not null references public.containers(id) on delete cascade,
  kind         text not null check (kind in ('painting', 'pti', 'cleaning', 'all_rounder')),
  unique (container_id, kind)
);

create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  section_id   uuid not null references public.sections(id) on delete cascade,
  key          text not null,
  label        text not null,
  worker_id    text references public.workers(id) on delete set null,
  state        text not null default 'pending' check (state in ('pending', 'running', 'done', 'na')),
  started_at   timestamptz,
  elapsed_sec  integer not null default 0,
  completed_at timestamptz,
  optional     boolean not null default false,
  est_hrs      numeric not null default 0,
  site         text,
  -- Overrides the section's default assignee type for this one task — e.g.
  -- Painting's tape/compressor tasks go to a Painter Helper, not the Painter
  -- doing Primer/coats/Logo. Same enum as workers.type; not a foreign key
  -- since it describes a role, not a specific worker row.
  owner_type   text check (owner_type in (
                 'painter', 'painter_helper', 'technician', 'all_rounder',
                 'cleaner', 'tea_boy', 'sailing_crew'
               )),
  -- Task keys (within the same section) this one waits on. Empty means
  -- "fall back to array order" — see paintingTaskBlockedBy in mockV2.ts.
  depends_on   text[] not null default '{}',
  unique (section_id, key)
);

-- A resumable intake-form snapshot — not normalised, because it's never
-- queried or joined, only ever loaded whole and thrown away once gated in or
-- replaced by a newer save (see GateFormDialog's handleSaveDraft).
create table public.drafts (
  id       text primary key,
  saved_at timestamptz not null default now(),
  data     jsonb not null
);

-- Plain table, not Supabase Auth: the app's existing custom-JWT login
-- (apps/api/src/auth.ts) looks a user up by email and checks password_hash
-- itself. Keeps that code working unchanged until Auth-vs-custom is decided;
-- swapping to Supabase Auth later replaces this table's role, not this
-- migration's other tables.
create table public.users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  role          text not null default 'viewer',
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create index idx_sections_container_id on public.sections(container_id);
create index idx_tasks_section_id on public.tasks(section_id);
create index idx_tasks_worker_id on public.tasks(worker_id);

alter table public.workers enable row level security;
alter table public.containers enable row level security;
alter table public.sections enable row level security;
alter table public.tasks enable row level security;
alter table public.drafts enable row level security;
alter table public.users enable row level security;
