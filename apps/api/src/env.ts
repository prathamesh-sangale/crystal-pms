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
