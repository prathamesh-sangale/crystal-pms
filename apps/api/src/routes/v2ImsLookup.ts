import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { findContainerMatches } from '../imsLookup.js';
import { parseOr422 } from '../http.js';

const lookupQuerySchema = z.object({ containerId: z.string().min(1) });

/**
 * A read-only bridge to the IMS's own container data, for the Gate-In
 * form's "Check IMS" button. JWT-authenticated like every other v2 route —
 * this is for the signed-in Admin, not an external system (that's the
 * separate API-key-gated `/api/external/yard-summary`). Strictly one-way:
 * there is no write route here, and none is planned — by explicit
 * instruction, nothing in this app ever writes back to IMS.
 */
export async function v2ImsLookupRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/ims-lookup', async (request, reply) => {
    const query = await parseOr422(lookupQuerySchema, request.query, reply);
    if (!query) return;
    const result = await findContainerMatches(query.containerId);
    return reply.send(result);
  });
}
