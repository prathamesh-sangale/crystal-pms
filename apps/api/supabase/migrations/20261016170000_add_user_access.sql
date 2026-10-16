-- Real access management, by direct request: the admin can give a worker
-- a login and choose which screens they can reach. Previously the only way
-- to add a login at all was running scripts/seedUsers.ts by hand, and
-- nothing server-side ever checked role on any route -- just a valid JWT.

alter table public.users
  add column worker_id text references public.workers(id) on delete set null,
  add column allowed_screens text[] not null default '{}';

-- One login per worker -- Postgres allows any number of nulls under a
-- unique constraint, so every worker without a login is unaffected.
alter table public.users add constraint users_worker_id_unique unique (worker_id);
