import { supabase } from './supabase.js';

interface IncrResult {
  current: number;
  ttl: number;
}

/**
 * `@fastify/rate-limit`'s default store is per-process memory -- on Vercel,
 * every serverless instance keeps its own independent counter, so a
 * configured limit (login: 10/minute) only ever held per instance, not in
 * aggregate (confirmed directly: a one-time 50-concurrent-request burst got
 * 0 of 50 rate-limited, see DEVELOPMENT-STATUS.md §6 item 83). This backs
 * the same counter with one shared Postgres table instead, via a single
 * atomic UPSERT (`rate_limit_incr`, in the migration) -- concurrent
 * requests landing on different instances can't each read-then-write the
 * same stale count, since the UPSERT's own row lock serializes them.
 *
 * `@fastify/rate-limit`'s own TypeScript types only declare `incr(key,
 * callback)`, but the plugin's real call site (node_modules/@fastify/
 * rate-limit/index.js) passes two more positional args, `timeWindow` and
 * `max` -- confirmed by reading the installed source, not assumed from the
 * (incomplete) .d.ts, and matching the shape the plugin's own built-in
 * LocalStore/RedisStore both rely on.
 */
export class SupabaseRateLimitStore {
  private readonly keyPrefix: string;

  constructor(options?: { keyPrefix?: string }) {
    this.keyPrefix = options?.keyPrefix ?? 'rl:';
  }

  incr(key: string, callback: (error: Error | null, result?: IncrResult) => void, timeWindow?: number, _max?: number): void {
    void (async () => {
      try {
        const { data, error } = await supabase().rpc('rate_limit_incr', {
          p_key: this.keyPrefix + key,
          p_window_ms: timeWindow ?? 60_000,
        });
        if (error) throw error;
        const row = (Array.isArray(data) ? data[0] : data) as { current_count: number; ttl_ms: number };
        callback(null, { current: row.current_count, ttl: Math.ceil(row.ttl_ms) });
      } catch (err) {
        callback(err instanceof Error ? err : new Error('Rate limit check failed.'));
      }
    })();
  }

  /** One child store per distinct rate-limited route, namespaced by method
   * + path so two routes with the same per-caller key never share a
   * counter -- same convention the plugin's own RedisStore uses. */
  child(routeOptions: { routeInfo?: { method?: string; url?: string } }): SupabaseRateLimitStore {
    const info = routeOptions.routeInfo;
    return new SupabaseRateLimitStore({ keyPrefix: `${this.keyPrefix}${info?.method ?? ''}${info?.url ?? ''}-` });
  }
}
