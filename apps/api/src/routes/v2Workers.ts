import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScreen } from '../auth.js';
import { conflict, notFound, parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

/** Mirrors mockV2.ts's WorkerType — kept in sync by hand for now, same
 * "temporary exception" the rest of v2's types already live under (SPEC.md
 * §6's "no value typed twice" applies once v2's types move into
 * @pms/shared, not before). */
const WORKER_TYPES = ['painter', 'painter_helper', 'technician', 'all_rounder', 'cleaner', 'tea_boy', 'sailing_crew'] as const;

const createWorkerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(WORKER_TYPES),
  active: z.boolean().default(true),
  notes: z.string().default(''),
});

const updateWorkerSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.enum(WORKER_TYPES).optional(),
    active: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

interface WorkerRow {
  id: string;
  name: string;
  type: string;
  active: boolean;
  notes: string;
}

function toWorker(row: WorkerRow): WorkerRow {
  return { id: row.id, name: row.name, type: row.type, active: row.active, notes: row.notes };
}

/**
 * The first slice of the v2 UI wired to a real database (Supabase), picked
 * deliberately as the simplest one — no nested sections/tasks, no live
 * timers — to prove the whole pattern (route -> supabase -> apps/web's api
 * client -> v2Store) end to end before extending it to containers/tasks,
 * the much larger slice.
 */
export async function v2WorkerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // Not manager-locked like the write routes below -- Live/Yard Board and
  // Dashboards all need worker names to show who's assigned, so any of the
  // four screens that actually touch a worker's name unlocks the read.
  app.get('/api/v2/workers', { preHandler: requireScreen('live', 'yard', 'workers', 'dashboards') }, async (_request, reply) => {
    const { data, error } = await supabase().from('workers').select('*').order('name');
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ workers: (data as WorkerRow[]).map(toWorker) });
  });

  app.post('/api/v2/workers', { preHandler: requireScreen('workers') }, async (request, reply) => {
    const body = await parseOr422(createWorkerSchema, request.body, reply);
    if (!body) return;
    const { data, error } = await supabase().from('workers').insert(body).select().single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(201).send({ worker: toWorker(data as WorkerRow) });
  });

  app.patch('/api/v2/workers/:id', { preHandler: requireScreen('workers') }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = await parseOr422(updateWorkerSchema, request.body, reply);
    if (!body) return;
    const { data, error } = await supabase().from('workers').update(body).eq('id', id).select().maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send(notFound('Worker'));
    return reply.send({ worker: toWorker(data as WorkerRow) });
  });

  app.delete('/api/v2/workers/:id', { preHandler: requireScreen('workers') }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // The FK (tasks.worker_id, "on delete set null") would otherwise null out
    // *finished* tasks too, not just the pending ones the client already
    // unassigns itself -- silently losing who actually did completed work.
    // Checked here, not left to the DB, since the column has no state check
    // of its own.
    const { data: doneOrRunning, error: taskErr } = await supabase()
      .from('tasks')
      .select('id')
      .eq('worker_id', id)
      .in('state', ['running', 'done'])
      .limit(1);
    if (taskErr) throw app.httpErrors.internalServerError(taskErr.message);
    if ((doneOrRunning ?? []).length > 0) {
      return reply.code(409).send(conflict('This worker has running or completed task history and can\'t be removed. Reassign or finish their work first.'));
    }

    // A login tied to this worker would survive the delete with
    // worker_id set to null -- invisible to Access Management from then on,
    // since that screen only lists logins by walking the worker list. Revoke
    // access there first, so removing a login stays a manager-only action.
    const { data: login, error: userErr } = await supabase().from('users').select('id').eq('worker_id', id).maybeSingle();
    if (userErr) throw app.httpErrors.internalServerError(userErr.message);
    if (login) {
      return reply.code(409).send(conflict('This worker has a login. Remove their access from Access Management before deleting them.'));
    }

    const { error } = await supabase().from('workers').delete().eq('id', id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });
}
