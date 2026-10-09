import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
import { notFound, parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';
import { fromContainerRow, toTaskInsert, type ContainerRow } from '../v2Mappers.js';

const CONTAINER_SELECT = '*, sections(*, tasks(*))';

const taskInputSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  workerId: z.string().nullable(),
  state: z.enum(['pending', 'running', 'done', 'na']),
  startedAt: z.number().nullable(),
  elapsedSec: z.number(),
  completedAt: z.string().nullable().optional(),
  optional: z.boolean().optional(),
  estHrs: z.number(),
  site: z.string().nullable(),
  ownerType: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  scheduledFor: z.string().nullable().optional(),
});

const createContainerSchema = z.object({
  id: z.string().min(1),
  typeCode: z.string().min(1),
  size: z.string().min(1),
  color: z.string().nullable(),
  priority: z.boolean(),
  registeredAt: z.string(),
  currentSite: z.string().nullable(),
  readyAt: z.string().nullable(),
  departedAt: z.string().nullable(),
  survey: z
    .object({ performedAt: z.string(), outcome: z.enum(['ready', 'needs-work']), fields: z.array(z.record(z.string(), z.unknown())) })
    .nullable(),
  gateIn: z.record(z.string(), z.unknown()).nullable(),
  gateOut: z.record(z.string(), z.unknown()).nullable(),
  sections: z.array(z.object({ kind: z.enum(['painting', 'pti', 'cleaning', 'all_rounder']), tasks: z.array(taskInputSchema) })),
});

/** Every field a container-level mutator (setPriority, markReady, gateOut,
 * updateContainer, the container-edit form) might send, in one loosely
 * validated bag — mirrors `mapContainer`'s own generic `{...c, ...updates}`
 * shape on the client, rather than one endpoint per action. */
const patchContainerSchema = z
  .object({
    typeCode: z.string().optional(),
    size: z.string().optional(),
    color: z.string().nullable().optional(),
    priority: z.boolean().optional(),
    currentSite: z.string().nullable().optional(),
    readyAt: z.string().nullable().optional(),
    departedAt: z.string().nullable().optional(),
    gateOut: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

const CONTAINER_FIELD_MAP: Record<string, string> = {
  typeCode: 'type_code',
  size: 'size',
  color: 'color',
  priority: 'priority',
  currentSite: 'current_site',
  readyAt: 'ready_at',
  departedAt: 'departed_at',
  gateOut: 'gate_out',
};

function toDbContainerPatch(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const col = CONTAINER_FIELD_MAP[k];
    if (col) out[col] = v;
  }
  return out;
}

/** Same idea for one task — every field startTask/stopTask/markTaskNA/
 * assignWorker/scheduleTask/unassignTask/setTaskSite might change, in one
 * bag instead of seven endpoints. */
const patchTaskSchema = z
  .object({
    workerId: z.string().nullable().optional(),
    state: z.enum(['pending', 'running', 'done', 'na']).optional(),
    startedAt: z.number().nullable().optional(),
    elapsedSec: z.number().optional(),
    completedAt: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
    scheduledFor: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update.' });

const TASK_FIELD_MAP: Record<string, string> = {
  workerId: 'worker_id',
  state: 'state',
  startedAt: 'started_at',
  elapsedSec: 'elapsed_sec',
  completedAt: 'completed_at',
  site: 'site',
  scheduledFor: 'scheduled_for',
};

function toDbTaskPatch(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const col = TASK_FIELD_MAP[k];
    if (!col) continue;
    out[col] = k === 'startedAt' && typeof v === 'number' ? new Date(v).toISOString() : v;
  }
  return out;
}

/**
 * The second, much larger slice of v2 wired to Supabase — containers, their
 * sections and tasks. Follows the exact pattern item 56 (workers) proved:
 * plain Fastify routes, `authenticate` only (no v1-style per-action
 * permission table, matching v2's single-Admin-account direction), zod for
 * shape not exhaustive business rules (the client already builds these
 * correctly; the server's job here is to catch genuinely malformed
 * requests, not re-implement every rule a second time).
 */
export async function v2ContainerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/containers', async (_request, reply) => {
    const { data, error } = await supabase().from('containers').select(CONTAINER_SELECT).order('registered_at', { ascending: false });
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.send({ containers: (data as ContainerRow[]).map(fromContainerRow) });
  });

  app.post('/api/v2/containers', async (request, reply) => {
    const body = await parseOr422(createContainerSchema, request.body, reply);
    if (!body) return;

    const { error: containerErr } = await supabase()
      .from('containers')
      .insert({
        id: body.id,
        type_code: body.typeCode,
        size: body.size,
        color: body.color,
        priority: body.priority,
        registered_at: body.registeredAt,
        current_site: body.currentSite,
        ready_at: body.readyAt,
        departed_at: body.departedAt,
        survey_performed_at: body.survey?.performedAt ?? null,
        survey_outcome: body.survey?.outcome ?? null,
        survey_fields: body.survey?.fields ?? [],
        gate_in: body.gateIn,
        gate_out: body.gateOut,
      });
    if (containerErr) throw app.httpErrors.internalServerError(containerErr.message);

    // Best-effort cleanup if anything below fails -- not a true transaction
    // (supabase-js's REST client doesn't expose one), but `on delete
    // cascade` on sections/tasks means removing the container removes any
    // partial rows it already got, so a failed gate-in never leaves orphans.
    try {
      if (body.sections.length > 0) {
        const { data: sectionRows, error: sectionErr } = await supabase()
          .from('sections')
          .insert(body.sections.map((s) => ({ container_id: body.id, kind: s.kind })))
          .select('id, kind');
        if (sectionErr) throw sectionErr;

        const taskRows = body.sections.flatMap((s, i) => {
          const sectionId = (sectionRows as Array<{ id: string; kind: string }>)[i]!.id;
          return s.tasks.map((t) => toTaskInsert(sectionId, t));
        });
        if (taskRows.length > 0) {
          const { error: taskErr } = await supabase().from('tasks').insert(taskRows);
          if (taskErr) throw taskErr;
        }
      }
    } catch (err) {
      await supabase().from('containers').delete().eq('id', body.id);
      const message = err instanceof Error ? err.message : 'Could not save this container’s sections.';
      throw app.httpErrors.internalServerError(message);
    }

    const { data: full, error: refetchErr } = await supabase().from('containers').select(CONTAINER_SELECT).eq('id', body.id).single();
    if (refetchErr) throw app.httpErrors.internalServerError(refetchErr.message);
    return reply.code(201).send({ container: fromContainerRow(full as ContainerRow) });
  });

  app.patch('/api/v2/containers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = await parseOr422(patchContainerSchema, request.body, reply);
    if (!body) return;
    const { data, error } = await supabase()
      .from('containers')
      .update(toDbContainerPatch(body))
      .eq('id', id)
      .select(CONTAINER_SELECT)
      .maybeSingle();
    if (error) throw app.httpErrors.internalServerError(error.message);
    if (!data) return reply.code(404).send(notFound('Container'));
    return reply.send({ container: fromContainerRow(data as ContainerRow) });
  });

  app.delete('/api/v2/containers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { error } = await supabase().from('containers').delete().eq('id', id);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return reply.code(204).send();
  });

  app.patch('/api/v2/containers/:id/tasks/:kind/:key', async (request, reply) => {
    const { id, kind, key } = request.params as { id: string; kind: string; key: string };
    const body = await parseOr422(patchTaskSchema, request.body, reply);
    if (!body) return;

    const { data: section, error: sectionErr } = await supabase()
      .from('sections')
      .select('id')
      .eq('container_id', id)
      .eq('kind', kind)
      .maybeSingle();
    if (sectionErr) throw app.httpErrors.internalServerError(sectionErr.message);
    if (!section) return reply.code(404).send(notFound('Section'));

    const { error: taskErr } = await supabase().from('tasks').update(toDbTaskPatch(body)).eq('section_id', (section as { id: string }).id).eq('key', key);
    if (taskErr) throw app.httpErrors.internalServerError(taskErr.message);

    const { data: full, error: refetchErr } = await supabase().from('containers').select(CONTAINER_SELECT).eq('id', id).single();
    if (refetchErr) throw app.httpErrors.internalServerError(refetchErr.message);
    return reply.send({ container: fromContainerRow(full as ContainerRow) });
  });
}
