import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(API_DIR, '.env');

/**
 * Load apps/api/.env, but let anything already in the real environment win.
 *
 * That precedence matters: the test runner sets its own JWT_SECRET/PORT/etc.
 * before this module is imported, and a .env file must never quietly
 * override a value a test run deliberately set.
 */
const fromEnvironment = { ...process.env };
if (existsSync(ENV_FILE)) {
  process.loadEnvFile(ENV_FILE);
  for (const [key, value] of Object.entries(fromEnvironment)) {
    if (value !== undefined) process.env[key] = value;
  }
}

/** Fail at boot with a readable message, not at the first request. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_SECRET: z.string().min(16, 'must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Required — Supabase is the only database this app has now. Nothing left
  // to fall back to if these are missing, so booting without them is a
  // config error, not a degraded-but-working state.
  SUPABASE_URL: z.string().min(1, 'not set — copy apps/api/.env.example to apps/api/.env'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'not set — copy apps/api/.env.example to apps/api/.env'),
  // Optional, by design — unset simply means the emailed-one-time-code sign-in
  // (routes/otpAuth.ts, an alternative to the password login above, not a
  // replacement for it) always 503s, same fail-closed shape as
  // DEV_LOGS_PASSWORD below. The anon key is the public-safe one Supabase
  // issues alongside the service_role key (Settings -> API) -- it's what
  // Supabase's own Auth.signInWithOtp/verifyOtp calls require, and unlike
  // SUPABASE_SERVICE_ROLE_KEY it's meant to be exposed, though it's still
  // only ever used here, server-side -- apps/web never talks to Supabase
  // directly, same as every other Supabase credential in this app.
  SUPABASE_ANON_KEY: z.string().optional(),
  // Optional — only needed where there's no local filesystem to read the
  // gitignored credentials file from (serverless deployments). See
  // googleAuth.ts for the fallback logic.
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // Optional, by design — unset simply means the developer-only action-log
  // route (routes/devLogs.ts) never accepts a password and stays
  // unreachable, not a reason to fail the whole API at boot like the
  // Supabase vars above. Nothing to do with the app's own users/sessions.
  // No minimum beyond non-empty, by direct request -- matches the login
  // route's own schema (routes/devLogs.ts), which already accepts any
  // non-empty password. Rate-limited the same way the login route is
  // (10/min), which is the actual guard against guessing a short value, not
  // length validation at boot.
  DEV_LOGS_PASSWORD: z.string().min(1).optional(),
  // Optional — the Gate Out order lookup against OMS's public API
  // (omsClient.ts). Both unset simply means the lookup is off and Gate Out
  // keeps a plain Order Number box. Read-only key (realm `orders`, scope
  // `read:core`) named "PMS - Gate Out order lookup" in OMS. OMS_API_URL is
  // the site root, e.g. https://oms.crystalgrp.xyz (no /api/v1).
  OMS_API_URL: z.string().min(1).optional(),
  OMS_API_KEY: z.string().min(1).optional(),
  // Off unless exactly "true" — the IMS-based Gate In / Gate Out rules
  // (gateRules.ts), agreed with the owner 2026-11-24. They only ever READ
  // IMS. Off means gate entries behave exactly as they did before the rules
  // existed.
  GATE_RULES_ENABLED: z.enum(['true', 'false']).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(
    `Invalid environment (checked ${existsSync(ENV_FILE) ? ENV_FILE : 'process environment only'}):\n${lines.join('\n')}`
  );
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
