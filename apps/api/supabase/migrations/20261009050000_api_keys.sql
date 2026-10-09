-- API keys for external, non-human callers (e.g. the IMS integration) --
-- a completely separate concept from apps/api's user JWT login, which is
-- for people signing in through the app itself. Only the key's hash is
-- ever stored, same reasoning as password_hash on public.users: even a
-- full database leak doesn't hand out a usable key. Revocation is a
-- soft-delete (`revoked_at`), not a row delete, so a key that was in use
-- can be audited after the fact rather than just vanishing.
create table public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  key_hash      text not null unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

alter table public.api_keys enable row level security;
