import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { logAction } from './actionLog.js';
import { env, isProduction } from './env.js';
import { zodToApiError } from './http.js';
import { SupabaseRateLimitStore } from './rateLimitStore.js';
import { authRoutes } from './routes/auth.js';
import { devLogsRoutes } from './routes/devLogs.js';
import { externalApiRoutes } from './routes/externalApi.js';
import { hydraMovementRoutes } from './routes/hydraMovements.js';
import { v2ContainerRoutes } from './routes/v2Containers.js';
import { v2DraftRoutes } from './routes/v2Drafts.js';
import { v2ExportRoutes } from './routes/v2Export.js';
import { v2ImsLookupRoutes } from './routes/v2ImsLookup.js';
import { v2PowerRoutes } from './routes/v2Power.js';
import { v2UploadRoutes } from './routes/v2Uploads.js';
import { v2UserRoutes } from './routes/v2Users.js';
import { v2WorkerRoutes } from './routes/v2Workers.js';

/** @fastify/rate-limit's own .d.ts for a custom store's `child()` declares
 * a `RouteOptions` parameter that doesn't match what the plugin actually
 * passes at runtime (confirmed by reading the installed source, not
 * guessed) -- so a correctly-typed store can never structurally satisfy
 * the stale type. This is the real, minimal shape instead, used only to
 * cast `SupabaseRateLimitStore` at the one call site that needs it. */
interface RateLimitStore {
  incr(key: string, callback: (error: Error | null, result?: { current: number; ttl: number }) => void): void;
  child(routeOptions: unknown): RateLimitStore;
}
type RateLimitStoreCtor = new (options: unknown) => RateLimitStore;

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isProduction
      ? true
      : { transport: undefined, level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
    // Container IDs contain spaces, which arrive percent-encoded.
    routerOptions: { ignoreTrailingSlash: true },
    // Behind Vercel's proxy, request.ip is otherwise the proxy's own
    // address (constant, shared across unrelated callers) rather than the
    // real visitor's -- rate limiting would key on the wrong thing
    // entirely. Vercel sets x-forwarded-for correctly, so this is safe.
    trustProxy: true,
  });

  await app.register(sensible);
  // Every destructive action in this app (delete container/worker/photo,
  // access-management changes) relies on a client-side-only confirm dialog
  // -- with no frame-ancestors/X-Frame-Options at all, a malicious page
  // could iframe the app over an already-signed-in session and trick a
  // click through one of those confirms. CSP itself stays off: this app's
  // screens are built almost entirely from inline `style={{...}}` props,
  // which a default CSP's `style-src` would silently break app-wide --
  // nowhere near worth it just to additionally duplicate what
  // X-Frame-Options already covers on its own.
  await app.register(helmet, { contentSecurityPolicy: false, frameguard: { action: 'deny' } });
  await app.register(cors, {
    origin: env.WEB_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    allowedHeaders: ['content-type', 'authorization'],
  });
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
    // A shared, Supabase-backed counter -- the default in-memory store
    // doesn't hold under concurrency on Vercel, where every serverless
    // instance keeps its own independent count (see rateLimitStore.ts).
    // Cast explained above (RateLimitStoreCtor).
    store: SupabaseRateLimitStore as unknown as RateLimitStoreCtor,
    // A Supabase hiccup should never be the reason login itself goes down
    // -- fails open (lets the request through unthrottled) rather than
    // 500ing, same tradeoff this app already makes elsewhere for anything
    // non-essential to the request actually succeeding.
    skipOnError: true,
  });
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

  // The one global hook in this app -- every other `preHandler` is scoped to
  // its own route file by Fastify's plugin encapsulation, but the
  // developer-only action log (devLogs.ts) needs every mutating request,
  // regardless of which file handles it. Runs after the real response has
  // already been sent, so it can never slow down or affect the request
  // itself -- see actionLog.ts for what gets logged and why.
  app.addHook('onResponse', logAction);

  app.get('/api/health', async () => ({ ok: true, service: 'crystal-pms' }));

  await app.register(authRoutes);
  await app.register(v2WorkerRoutes);
  await app.register(v2ContainerRoutes);
  await app.register(v2DraftRoutes);
  await app.register(v2UploadRoutes);
  await app.register(v2ImsLookupRoutes);
  await app.register(v2ExportRoutes);
  await app.register(v2PowerRoutes);
  await app.register(v2UserRoutes);
  await app.register(hydraMovementRoutes);
  await app.register(externalApiRoutes);
  await app.register(devLogsRoutes);

  return app;
}
