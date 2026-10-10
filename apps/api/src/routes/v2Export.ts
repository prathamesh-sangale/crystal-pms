import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { exportToSheet } from '../pmsSheetExport.js';

/** One on-demand action: refresh every tab of the client's own "PMS"
 * Google Sheet from current data. Not a live sync -- deliberately a
 * button the Admin clicks, same shape as every other export in this app
 * (Hydra's CSV, the now-removed syncSheet.ts). */
export async function v2ExportRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/api/v2/export-sheet', async (_request, reply) => {
    const result = await exportToSheet();
    return reply.send({ ok: true, ...result });
  });
}
