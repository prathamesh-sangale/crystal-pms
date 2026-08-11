import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env, isProduction } from './env.js';
import { zodToApiError } from './http.js';
import { authRoutes } from './routes/auth.js';
import { containerRoutes } from './routes/containers.js';
import { overviewRoutes } from './routes/overview.js';
import { referenceRoutes } from './routes/reference.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProduction
      ? true
      : { transport: undefined, level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
    // Container IDs contain spaces, which arrive percent-encoded.
    routerOptions: { ignoreTrailingSlash: true },
  });

  await app.register(sensible);
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', 'x-today'],
  });
  await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });

  /** Every failure leaves as the same shape, so the UI has one thing to render. */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send(zodToApiError(error));
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: error.code ?? 'request_failed',
        message: error.message,
      });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Something went wrong at our end. The action was not saved.',
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: 'not_found',
      message: `No route for ${request.method} ${request.url}.`,
    })
  );

  app.get('/api/health', async () => ({ ok: true, service: 'reefer-ready-pms' }));

  await app.register(authRoutes);
  await app.register(referenceRoutes);
  await app.register(containerRoutes);
  await app.register(overviewRoutes);

  return app;
}
