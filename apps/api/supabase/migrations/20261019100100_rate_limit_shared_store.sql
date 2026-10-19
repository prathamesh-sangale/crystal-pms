-- @fastify/rate-limit's default store is per-process memory -- on Vercel,
-- every serverless instance keeps its own independent counter, so a
-- configured limit (login: 10/minute) only ever holds per instance, not in
-- aggregate across however many instances are warm. This is the shared
-- counter apps/api/src/rateLimitStore.ts reads/writes instead, via one
-- atomic UPSERT per request so concurrent requests landing on different
-- instances can't each read-then-write the same stale count.
create table public.rate_limit_hits (
  key      text primary key,
  count    integer not null default 1,
  reset_at timestamptz not null
);

alter table public.rate_limit_hits enable row level security;

-- Single round trip, atomic under concurrency: the UPSERT's own row lock
-- serializes two simultaneous hits on the same key, so neither can read the
-- other's pre-increment count -- the one correctness property a shared
-- rate-limit counter actually needs (unlike token_version above, which has
-- no such requirement, by design).
create or replace function public.rate_limit_incr(p_key text, p_window_ms bigint)
returns table(current_count integer, ttl_ms bigint)
language plpgsql
as $$
declare
  v_now   timestamptz := clock_timestamp();
  v_count integer;
  v_reset timestamptz;
begin
  insert into public.rate_limit_hits (key, count, reset_at)
  values (p_key, 1, v_now + (p_window_ms || ' milliseconds')::interval)
  on conflict (key) do update
    set count = case
          when public.rate_limit_hits.reset_at <= v_now then 1
          else public.rate_limit_hits.count + 1
        end,
        reset_at = case
          when public.rate_limit_hits.reset_at <= v_now then v_now + (p_window_ms || ' milliseconds')::interval
          else public.rate_limit_hits.reset_at
        end
  returning count, reset_at into v_count, v_reset;

  return query select v_count, greatest(0, extract(epoch from (v_reset - v_now)) * 1000)::bigint;
end;
$$;
