import { loginSchema } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { authenticate, verifyPassword, type Role, type Screen, type SessionUser } from '../auth.js';
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

      const session: SessionUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as Role,
        workerId: user.worker_id,
        allowedScreens: (user.allowed_screens ?? []) as Screen[],
        tokenVersion: user.token_version,
      };
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    },
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({ user: request.user }));
}
