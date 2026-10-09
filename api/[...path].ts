import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../apps/api/src/app.js';

/**
 * Vercel's Node runtime keeps a warm serverless instance alive across
 * invocations, so memoizing the built-and-ready app here means only the
 * first request after a cold start pays for `buildApp()` — every request
 * after that reuses it, same as the long-running process in server.ts does.
 */
let appPromise: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildApp().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit('request', req, res);
}
