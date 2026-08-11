import { loginSchema } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { authenticate, verifyPassword, type Role, type SessionUser } from '../auth.js';
import { prisma } from '../db.js';
import { parseOr422 } from '../http.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', {
    config: {
      // Slows credential stuffing without getting in a real person's way.
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(loginSchema, request.body, reply);
      if (!body) return;

      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

      // Same response and roughly the same work whether the account exists or
      // the password is wrong, so the endpoint does not confirm who has one.
      const ok = user ? verifyPassword(body.password, user.passwordHash) : false;
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
        depotId: user.depotId,
      };
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    },
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ({ user: request.user }));
}
