import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * The only Supabase client in this app, and the only thing that ever talks to
 * Supabase at all — apps/web never does, so the browser never sees these
 * credentials. Always the service_role key: RLS is enabled with no
 * permissive policies (see the migration), so the anon key can't read or
 * write anything anyway, and this server is the trusted caller the service
 * role key is for.
 *
 * Lazy and memoized rather than built at import time, so a server still
 * running on the Prisma backend can import this module without SUPABASE_URL
 * / SUPABASE_SERVICE_ROLE_KEY being set yet — it only throws once something
 * actually tries to use Supabase.
 */
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (client) return client;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/api/.env (see .env.example).'
    );
  }
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

let anonClient: SupabaseClient | null = null;

/**
 * A second, deliberately narrower client -- the anon key, not service_role.
 * Its only job is triggering/verifying Supabase's own built-in email-OTP
 * Auth flow (routes/otpAuth.ts); it is never used to read or write this
 * app's actual data (RLS already blocks the anon key from that regardless).
 * Lazy/memoized and `persistSession: false` for the same reasons as
 * `supabase()` above -- this is a short-lived server-side client, not a
 * browser session.
 */
export function supabaseAnon(): SupabaseClient {
  if (anonClient) return anonClient;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error(
      'Email-code sign-in is not configured — set SUPABASE_ANON_KEY in apps/api/.env (see .env.example).'
    );
  }
  anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return anonClient;
}
