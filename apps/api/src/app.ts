import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { env, isProduction } from './env.js';
import { zodToApiError } from './http.js';
import { authRoutes } from './routes/auth.js';
import { externalApiRoutes } from './routes/externalApi.js';
import { v2ContainerRoutes } from './routes/v2Containers.js';
import { v2DraftRoutes } from './routes/v2Drafts.js';
import { v2ImsLookupRoutes } from './routes/v2ImsLookup.js';
import { v2UploadRoutes } from './routes/v2Uploads.js';
import { v2WorkerRoutes } from './routes/v2Workers.js';

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
    allowedHeaders: ['content-type', 'authorization'],
  });
  await app.register(rateLimit, { global: false, max: 300, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.JWT_SECRET });
  await app.register(multipart);

  /** Every failure leaves as the same shape, so the UI has one thing to render. */
  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ZodError) return reply.code(422).send(zodToApiError(error));

    const failure = error as { statusCode?: number; code?: string; message?: string };
    // 4xx is something the caller can fix, so its message is safe to pass on.
    // 5xx is ours, and its message may leak internals — so it never leaves.
    if (failure.statusCode && failure.statusCode >= 400 && failure.statusCode < 500) {
      return reply.code(failure.statusCode).send({
        error: failure.code ?? 'request_failed',
        message: failure.message ?? 'That request could not be completed.',
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
  await app.register(v2WorkerRoutes);
  await app.register(v2ContainerRoutes);
  await app.register(v2DraftRoutes);
  await app.register(v2UploadRoutes);
  await app.register(v2ImsLookupRoutes);
  await app.register(externalApiRoutes);

  return app;
}
