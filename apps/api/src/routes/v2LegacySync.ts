import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScreen } from '../auth.js';
import { parseOr422 } from '../http.js';
import { legacySwitches, resumePendingSyncs, runLegacyImport, runLegacySync, type ImportSummary } from '../legacySync.js';

const syncBodySchema = z.object({ kind: z.enum(['in', 'out']) });

/** One catch-up at a time per server instance, at most every 90 s. */
let lastCatchUp = 0;
let catchUpRunning = false;

/**
 * The legacy Gate-In portal sync (legacySync.ts). Every write it makes is
 * behind its own switch in env.ts; with them off these routes answer
 * `enabled: false` and change nothing anywhere.
 */
export async function v2LegacySyncRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/legacy-sync/status', { preHandler: requireScreen('live', 'yard') }, async (_request, reply) => {
    return reply.send({ switches: legacySwitches() });
  });

  // Called by the gate form right after a gate entry saves; runs the next
  // pending steps within the request time limit. Safe to call repeatedly.
  app.post('/api/v2/containers/:id/legacy-sync', { preHandler: requireScreen('live', 'yard') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = await parseOr422(syncBodySchema, request.body, reply);
    if (!body) return;
    try {
      const state = await runLegacySync(id, body.kind, request.user.email);
      return reply.send({ enabled: state !== null, state });
    } catch (err) {
      request.log.error({ err, id }, 'legacy sync failed');
      return reply.code(502).send({ error: 'legacy_sync_failed', message: err instanceof Error ? err.message : 'Legacy sync failed.' });
    }
  });

  // Called by the app shell every few minutes: mirrors new old-portal ledger
  // rows into PMS, then resumes any unfinished PMS -> sheets syncs.
  app.post('/api/v2/legacy-sync/catch-up', { preHandler: requireScreen('live', 'yard') }, async (request, reply) => {
    const switches = legacySwitches();
    if (!switches.import && !switches.sync) return reply.send({ enabled: false });
    if (catchUpRunning || Date.now() - lastCatchUp < 90_000) return reply.send({ enabled: true, throttled: true });
    catchUpRunning = true;
    lastCatchUp = Date.now();
    const started = Date.now();
    let imported: ImportSummary | null = null;
    let resumed = 0;
    try {
      imported = await runLegacyImport();
      resumed = await resumePendingSyncs(request.user.email, Math.max(0, 7000 - (Date.now() - started)));
    } catch (err) {
      request.log.error({ err }, 'legacy catch-up failed');
    } finally {
      catchUpRunning = false;
    }
    return reply.send({
      enabled: true,
      created: imported?.created ?? [],
      gatedOut: imported?.gatedOut ?? [],
      skipped: imported?.skipped.length ?? 0,
      resumed,
    });
  });
}
