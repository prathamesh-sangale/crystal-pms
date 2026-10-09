import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

const saveDraftSchema = z.object({
  id: z.string().min(1),
  savedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

interface DraftRow {
  id: string;
  saved_at: string;
  data: unknown;
}

function toDraft(row: DraftRow): Record<string, unknown> {
  return { id: row.id, savedAt: row.saved_at, data: row.data };
}

/** Third and last slice of v2 wired to Supabase — the resumable intake-form
 * snapshot. Smallest of the three: one flat table, no nested shape, same
 * size of job as workers. */
export async function v2DraftRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/drafts', async (_request, reply) => {
    const { data, error } = await supabase().from('drafts').select('*').order('saved_at', { ascending: false });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ drafts: (data as DraftRow[]).map(toDraft) });
  });

  app.post('/api/v2/drafts', async (request, reply) => {
    const body = await parseOr422(saveDraftSchema, request.body, reply);
    if (!body) return;
    const { data, error } = await supabase()
      .from('drafts')
      .insert({ id: body.id, saved_at: body.savedAt, data: body.data })
      .select()
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send({ draft: toDraft(data as DraftRow) });
  });

  app.delete('/api/v2/drafts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await supabase().from('drafts').delete().eq('id', id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
}
