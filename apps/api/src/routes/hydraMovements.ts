import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

const createMovementSchema = z.object({
  movementDate: z.string().min(1),
  containerNo: z.string().min(1),
  type: z.string().min(1),
  size: z.string().min(1),
  movementType: z.enum(['Loading', 'Unloading', 'Shifting']),
  direction: z.enum(['IN', 'OUT']).nullable(),
  fileId: z.string().nullable().default(null),
  fileUrl: z.string().nullable().default(null),
});

interface MovementRow {
  id: string;
  movement_date: string;
  container_no: string;
  type: string;
  size: string;
  movement_type: string;
  direction: string | null;
  file_id: string | null;
  file_url: string | null;
  logged_by: string | null;
  created_at: string;
}

function toMovement(row: MovementRow) {
  return {
    id: row.id,
    movementDate: row.movement_date,
    containerNo: row.container_no,
    type: row.type,
    size: row.size,
    movementType: row.movement_type,
    direction: row.direction,
    fileId: row.file_id,
    fileUrl: row.file_url,
    loggedBy: row.logged_by,
    createdAt: row.created_at,
  };
}

/**
 * Hydra — a standalone movement log (loading/unloading/shifting), explicitly
 * independent of the readiness workflow's own containers/sections/tasks.
 * Append-only by design, matching the original spec this was built from:
 * there's no edit/delete route here, only create and list.
 */
export async function hydraMovementRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/hydra', async (_request, reply) => {
    const { data, error } = await supabase().from('hydra_movements').select('*').order('movement_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ movements: (data as MovementRow[]).map(toMovement) });
  });

  app.post('/api/v2/hydra', async (request, reply) => {
    const body = await parseOr422(createMovementSchema, request.body, reply);
    if (!body) return;
    const { data, error } = await supabase()
      .from('hydra_movements')
      .insert({
        movement_date: body.movementDate,
        container_no: body.containerNo,
        type: body.type,
        size: body.size,
        movement_type: body.movementType,
        direction: body.direction,
        file_id: body.fileId,
        file_url: body.fileUrl,
        logged_by: request.user.email,
      })
      .select()
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send({ movement: toMovement(data as MovementRow) });
  });
}
