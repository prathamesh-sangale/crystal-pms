import { z } from 'zod';

/**
 * Fail at boot with a readable message rather than at the first request with
 * `undefined is not a string`.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is not set — copy apps/api/.env.example to .env'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment:\n${lines.join('\n')}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
