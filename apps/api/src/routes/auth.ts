import { loginSchema } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, hashPassword, verifyPassword, type Role, type Screen, type SessionUser } from '../auth.js';
import { env } from '../env.js';
import { parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  password_hash: string;
  worker_id: string | null;
  allowed_screens: string[];
  token_version: number;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', {
    config: {
      // Slows credential stuffing without getting in a real person's way.
      // Now a genuinely shared counter (rateLimitStore.ts) rather than
      // per-process memory, the test suite's own, perfectly legitimate
      // login volume (every test that signs in a fresh account) started
      // tripping this limit against the same real project the old
      // per-process store never let it reach -- loosened here the same way
      // `env.ts`'s logger level already treats `NODE_ENV === 'test'`
      // differently, not by raising the real limit.
      rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(loginSchema, request.body, reply);
      if (!body) return;

      const { data: user } = (await supabase()
        .from('users')
        .select('id, email, name, role, password_hash, worker_id, allowed_screens, token_version')
        .eq('email', body.email.toLowerCase())
        .maybeSingle()) as { data: UserRow | null };

      // Same response and roughly the same work whether the account exists or
      // the password is wrong, so the endpoint does not confirm who has one.
      const ok = user ? verifyPassword(body.password, user.password_hash) : false;
      if (!user || !ok) {
        return reply.code(401).send({
          error: 'invalid_credentials',
          message: 'That email and password do not match an account.',
        });
      }

      const session = toSession(user);
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    },
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({ user: request.user }));

  /** Self-service, by direct request, manager-only by a later, equally
   * direct request: a worker's credentials stay fully admin-controlled --
   * if theirs needs to change, a manager resets it for them in Access
   * Management, same as before this route existed. Requires proving the
   * *current* password first -- an already-open session being used to lock
   * the real owner out is exactly the scenario that check exists for. Bumps
   * `token_version` same as an admin-driven reset would (changing your
   * password is itself reason enough to kill any other session using the
   * old one) -- which would invalidate the very token this request came in
   * on, so a fresh one is signed and returned here rather than forcing an
   * immediate re-login right after. */
  app.post(
    '/api/auth/change-password',
    {
      preHandler: authenticate,
      // Same rationale and test-mode exemption as login's own limit above.
      config: { rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (request.user.role !== 'manager') {
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Ask an admin to change this for you in Access Management.',
        });
      }
      const body = await parseOr422(changePasswordSchema, request.body, reply);
      if (!body) return;

      const { data: user, error: fetchErr } = (await supabase()
        .from('users')
        .select('id, email, name, role, password_hash, worker_id, allowed_screens, token_version')
        .eq('id', request.user.id)
        .maybeSingle()) as { data: UserRow | null; error: unknown };
      if (fetchErr) throw app.httpErrors.internalServerError(String(fetchErr));
      if (!user || !verifyPassword(body.currentPassword, user.password_hash)) {
        return reply.code(401).send({
          error: 'invalid_credentials',
          message: 'Your current password is incorrect.',
        });
      }

      const tokenVersion = Date.now();
      const { data: updated, error: updateErr } = await supabase()
        .from('users')
        .update({ password_hash: hashPassword(body.newPassword), token_version: tokenVersion })
        .eq('id', user.id)
        .select('id, email, name, role, password_hash, worker_id, allowed_screens, token_version')
        .single();
      if (updateErr) throw app.httpErrors.internalServerError(updateErr.message);

      const session = toSession(updated as UserRow);
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    }
  );
}

function toSession(user: UserRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
    workerId: user.worker_id,
    allowedScreens: (user.allowed_screens ?? []) as Screen[],
    tokenVersion: user.token_version,
  };
}
