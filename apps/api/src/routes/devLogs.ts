import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SessionUser } from '../auth.js';
import { env } from '../env.js';
import { parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

const loginSchema = z.object({ password: z.string().min(1) });

/** A fixed-shape payload that looks nothing like `SessionUser` (see
 * auth.ts), by design -- this token must never be usable as, or confused
 * with, a real login session, and a real user's own token must never pass
 * as this one. Deliberately not assigned to `request.user` anywhere in this
 * file, which stays typed for `SessionUser` globally (auth.ts's module
 * augmentation) -- this route never touches it. That same augmentation
 * fixes `app.jwt.sign`'s payload type to `SessionUser` app-wide, so signing
 * this genuinely different shape needs a cast at the one call site below --
 * not a sign of a mistake, just the library having no way to express "this
 * app issues two unrelated kinds of token." */
interface DevLogsPayload {
  devLogs: true;
}

/** Plain string comparison would leak timing information about how many
 * leading characters matched -- same reasoning as `verifyPassword` in
 * auth.ts, just without the scrypt hashing (this isn't a stored-password
 * check, it's one fixed secret from an env var). */
function passwordMatches(candidate: string): boolean {
  if (!env.DEV_LOGS_PASSWORD) return false;
  const expected = Buffer.from(env.DEV_LOGS_PASSWORD);
  const actual = Buffer.from(candidate);
  if (actual.length !== expected.length) {
    // timingSafeEqual requires equal-length buffers -- still compare
    // against something of the right length so a short guess doesn't
    // short-circuit any faster than a full-length wrong one.
    timingSafeEqual(Buffer.alloc(expected.length), Buffer.alloc(expected.length));
    return false;
  }
  return timingSafeEqual(actual, expected);
}

async function requireDevLogsAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    const payload = await request.jwtVerify<DevLogsPayload>();
    if (payload.devLogs !== true) throw new Error('wrong token type');
  } catch {
    await reply.code(401).send({ error: 'unauthorized', message: 'Sign in to the action log again.' });
  }
}

const querySchema = z.object({
  category: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  beforeId: z.coerce.number().int().positive().optional(),
});

export async function devLogsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/dev/logs/login',
    {
      // Same brute-force throttling as the real login route, same
      // test-mode exemption (routes/auth.ts) -- this is still a password
      // check reachable by anyone who finds the URL.
      config: { rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = await parseOr422(loginSchema, request.body, reply);
      if (!body) return;
      if (!passwordMatches(body.password)) {
        return reply.code(401).send({ error: 'invalid_credentials', message: 'Wrong password.' });
      }
      const token = app.jwt.sign(({ devLogs: true } satisfies DevLogsPayload) as unknown as SessionUser, { expiresIn: '2h' });
      return reply.send({ token });
    }
  );

  app.get('/api/dev/logs', { preHandler: requireDevLogsAuth }, async (request, reply) => {
    const query = await parseOr422(querySchema, request.query, reply);
    if (!query) return;

    let q = supabase().from('action_logs').select('*').order('id', { ascending: false }).limit(query.limit);
    if (query.category) q = q.eq('category', query.category);
    if (query.since) q = q.gte('created_at', query.since);
    if (query.until) q = q.lte('created_at', query.until);
    if (query.beforeId) q = q.lt('id', query.beforeId);

    const { data, error } = await q;
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ logs: data ?? [] });
  });

  app.get('/api/dev/logs/categories', { preHandler: requireDevLogsAuth }, async (_request, reply) => {
    // Supabase/PostgREST has no `select distinct` through the query builder
    // -- cheap enough to pull a bounded page of recent categories and
    // de-dupe client-side rather than reach for raw SQL over one small list.
    const { data, error } = await supabase().from('action_logs').select('category').order('id', { ascending: false }).limit(2000);
    if (error) throw app.httpErrors.internalServerError(error.message);
    const categories = [...new Set((data ?? []).map((r: { category: string }) => r.category))].sort();
    return reply.send({ categories });
  });
}
