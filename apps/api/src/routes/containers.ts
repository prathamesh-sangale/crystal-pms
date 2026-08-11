import {
  STAGES,
  STAGE_BY_ID,
  TASKS_BY_STAGE,
  advanceStageSchema,
  checklistFor,
  containerQuerySchema,
  createContainerSchema,
  isLate,
  isReady,
  nextStage,
  stageBudget,
  toggleTaskSchema,
  totalPlanDays,
  updateContainerSchema,
  type Container,
} from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { authenticate, requirePermission } from '../auth.js';
import { prisma } from '../db.js';
import { conflict, notFound, parseOr422 } from '../http.js';
import { atLocalMidnight, containerInclude, toContainer } from '../mappers.js';
import { todayFor } from '../today.js';

export async function containerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  /* --------------------------------------------------------------------- */
  /* List                                                                   */
  /* --------------------------------------------------------------------- */
  app.get('/api/containers', async (request, reply) => {
    const query = await parseOr422(containerQuerySchema, request.query, reply);
    if (!query) return;
    const today = todayFor(request);

    const rows = await prisma.container.findMany({
      include: containerInclude,
      where: {
        ...(query.depot ? { depot: { name: query.depot } } : {}),
        ...(query.stage ? { stage: query.stage } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
      },
      orderBy: [{ priority: 'asc' }, { stageEntered: 'asc' }],
    });

    let containers = rows.map(toContainer);

    if (query.q) {
      const q = query.q.toLowerCase();
      containers = containers.filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          c.customer.toLowerCase().includes(q) ||
          c.assignee.toLowerCase().includes(q) ||
          c.depot.toLowerCase().includes(q)
      );
    }

    // Late and ready are derived, not stored, so they are filtered here rather
    // than in SQL. There is exactly one definition of each, in @pms/shared.
    if (query.status === 'late') containers = containers.filter((c) => isLate(c, today));
    else if (query.status === 'ready') containers = containers.filter(isReady);
    else if (query.status === 'active') containers = containers.filter((c) => !isReady(c));

    return reply.send({ containers, today });
  });

  /* --------------------------------------------------------------------- */
  /* Read one, with its audit trail                                         */
  /* --------------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>('/api/containers/:id', async (request, reply) => {
    const row = await prisma.container.findUnique({
      where: { id: request.params.id },
      include: containerInclude,
    });
    if (!row) return reply.code(404).send(notFound(`Container ${request.params.id}`));

    const [events, technician] = await Promise.all([
      prisma.containerEvent.findMany({
        where: { containerId: row.id },
        orderBy: { at: 'desc' },
        take: 50,
      }),
      prisma.technician.findUnique({
        where: { id: row.technicianId },
        include: { backup: true },
      }),
    ]);

    return reply.send({
      container: toContainer(row),
      backup: technician?.backup?.name ?? null,
      events: events.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        kind: e.kind,
        summary: e.summary,
        actor: e.actor,
      })),
      today: todayFor(request),
    });
  });

  /* --------------------------------------------------------------------- */
  /* Register a container                                                   */
  /* --------------------------------------------------------------------- */
  app.post(
    '/api/containers',
    { preHandler: requirePermission('container:create') },
    async (request, reply) => {
      const body = await parseOr422(createContainerSchema, request.body, reply);
      if (!body) return;

      const existing = await prisma.container.findUnique({ where: { id: body.id } });
      if (existing) {
        return reply.code(409).send({
          error: 'conflict',
          message: `${body.id} is already in the pipeline, at ${STAGE_BY_ID[existing.stage as never]?.name ?? existing.stage}.`,
          fields: { id: 'This container is already registered' },
        });
      }

      const [depot, technician] = await Promise.all([
        prisma.depot.findUnique({ where: { name: body.depot } }),
        prisma.technician.findUnique({ where: { name: body.assignee } }),
      ]);
      if (!depot) {
        return reply.code(422).send({
          error: 'validation_failed',
          message: 'That depot is not in the network.',
          fields: { depot: 'Choose a depot from the list' },
        });
      }
      if (!technician) {
        return reply.code(422).send({
          error: 'validation_failed',
          message: 'That technician is not on the roster.',
          fields: { assignee: 'Choose a technician from the list' },
        });
      }

      const today = todayFor(request);
      const actor = request.user?.name ?? 'system';

      const created = await prisma.container.create({
        include: containerInclude,
        data: {
          id: body.id,
          size: body.size,
          type: body.type,
          anteroomVariant: body.anteroomVariant,
          customer: body.customer,
          priority: body.priority,
          notes: body.notes,
          depotId: depot.id,
          technicianId: technician.id,
          stage: 'gatein',
          received: atLocalMidnight(today),
          stageEntered: atLocalMidnight(today),
          // The checklist is snapshotted now. Editing the task library later
          // never rewrites work that has already been signed off.
          tasks: {
            create: checklistFor(body.type).map((t) => ({
              key: t.key,
              stage: t.stage,
              label: t.label,
              hrs: t.hrs,
              onlyFor: t.onlyFor ? JSON.stringify(t.onlyFor) : null,
            })),
          },
          events: {
            create: {
              kind: 'registered',
              actor,
              summary: `Registered at ${depot.name} as ${body.type === 'anteroom' ? `${body.type} (${body.anteroomVariant})` : body.type}, assigned to ${technician.name}.`,
            },
          },
        },
      });

      return reply.code(201).send({ container: toContainer(created), today });
    }
  );

  /* --------------------------------------------------------------------- */
  /* Update details                                                         */
  /* --------------------------------------------------------------------- */
  app.patch<{ Params: { id: string } }>(
    '/api/containers/:id',
    { preHandler: requirePermission('container:update') },
    async (request, reply) => {
      const body = await parseOr422(updateContainerSchema, request.body, reply);
      if (!body) return;

      const current = await prisma.container.findUnique({
        where: { id: request.params.id },
        include: containerInclude,
      });
      if (!current) return reply.code(404).send(notFound(`Container ${request.params.id}`));

      const changes: string[] = [];
      let depotId = current.depotId;
      let technicianId = current.technicianId;

      if (body.depot && body.depot !== current.depot.name) {
        const depot = await prisma.depot.findUnique({ where: { name: body.depot } });
        if (!depot) {
          return reply.code(422).send({
            error: 'validation_failed',
            message: 'That depot is not in the network.',
            fields: { depot: 'Choose a depot from the list' },
          });
        }
        depotId = depot.id;
        changes.push(`depot ${current.depot.name} → ${depot.name}`);
      }
      if (body.assignee && body.assignee !== current.technician.name) {
        const tech = await prisma.technician.findUnique({ where: { name: body.assignee } });
        if (!tech) {
          return reply.code(422).send({
            error: 'validation_failed',
            message: 'That technician is not on the roster.',
            fields: { assignee: 'Choose a technician from the list' },
          });
        }
        technicianId = tech.id;
        changes.push(`technician ${current.technician.name} → ${tech.name}`);
      }
      if (body.priority && body.priority !== current.priority) {
        changes.push(`priority ${current.priority} → ${body.priority}`);
      }
      if (body.customer && body.customer !== current.customer) {
        changes.push(`customer ${current.customer} → ${body.customer}`);
      }
      if (body.notes !== undefined && body.notes !== current.notes) changes.push('notes updated');

      const updated = await prisma.container.update({
        where: { id: current.id },
        include: containerInclude,
        data: {
          customer: body.customer ?? undefined,
          priority: body.priority ?? undefined,
          notes: body.notes ?? undefined,
          depotId,
          technicianId,
          ...(changes.length
            ? {
                events: {
                  create: {
                    kind: 'updated',
                    actor: request.user?.name ?? 'system',
                    summary: changes.join(', '),
                  },
                },
              }
            : {}),
        },
      });

      return reply.send({ container: toContainer(updated), today: todayFor(request) });
    }
  );

  /* --------------------------------------------------------------------- */
  /* Tick a checklist item                                                  */
  /* --------------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/containers/:id/tasks',
    { preHandler: requirePermission('container:task') },
    async (request, reply) => {
      const body = await parseOr422(toggleTaskSchema, request.body, reply);
      if (!body) return;

      const task = await prisma.containerTask.findUnique({
        where: { containerId_key: { containerId: request.params.id, key: body.key } },
      });
      if (!task) return reply.code(404).send(notFound(`Task ${body.key}`));

      const actor = request.user?.name ?? 'system';
      await prisma.$transaction([
        prisma.containerTask.update({
          where: { id: task.id },
          data: {
            done: body.done,
            doneAt: body.done ? new Date() : null,
            doneBy: body.done ? actor : null,
          },
        }),
        prisma.containerEvent.create({
          data: {
            containerId: request.params.id,
            kind: body.done ? 'task-done' : 'task-undone',
            actor,
            summary: `${body.done ? 'Completed' : 'Reopened'} “${task.label}”`,
          },
        }),
      ]);

      const row = await prisma.container.findUniqueOrThrow({
        where: { id: request.params.id },
        include: containerInclude,
      });
      return reply.send({ container: toContainer(row), today: todayFor(request) });
    }
  );

  /* --------------------------------------------------------------------- */
  /* Advance a stage                                                        */
  /* --------------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/containers/:id/advance',
    { preHandler: requirePermission('container:advance') },
    async (request, reply) => {
      const body = await parseOr422(advanceStageSchema, request.body ?? {}, reply);
      if (!body) return;

      const row = await prisma.container.findUnique({
        where: { id: request.params.id },
        include: containerInclude,
      });
      if (!row) return reply.code(404).send(notFound(`Container ${request.params.id}`));

      const container: Container = toContainer(row);
      const target = nextStage(container.stage);
      if (!target) {
        return reply
          .code(409)
          .send(conflict('This container is already at final QC — there is no next stage.'));
      }

      const open = container.checklist.filter((t) => t.stage === container.stage && !t.done);
      if (open.length && !body.force) {
        return reply.code(409).send({
          error: 'stage_incomplete',
          message: `${open.length} task${open.length === 1 ? '' : 's'} still open in ${STAGE_BY_ID[container.stage].name}.`,
          fields: {},
          // The UI turns this into a confirmation naming the consequence.
          openTasks: open.map((t) => t.label),
          nextStage: STAGE_BY_ID[target].name,
        });
      }

      const today = todayFor(request);
      const actor = request.user?.name ?? 'system';
      const updated = await prisma.container.update({
        where: { id: container.id },
        include: containerInclude,
        data: {
          stage: target,
          stageEntered: atLocalMidnight(today),
          events: {
            create: {
              kind: 'stage-advanced',
              actor,
              summary:
                `${STAGE_BY_ID[container.stage].name} → ${STAGE_BY_ID[target].name}` +
                (open.length ? ` (advanced with ${open.length} task(s) still open)` : ''),
            },
          },
        },
      });

      return reply.send({ container: toContainer(updated), today });
    }
  );

  /* --------------------------------------------------------------------- */
  /* Remove from the pipeline                                               */
  /* --------------------------------------------------------------------- */
  app.delete<{ Params: { id: string } }>(
    '/api/containers/:id',
    { preHandler: requirePermission('container:delete') },
    async (request, reply) => {
      const row = await prisma.container.findUnique({ where: { id: request.params.id } });
      if (!row) return reply.code(404).send(notFound(`Container ${request.params.id}`));

      // Cascades to tasks and events by schema. The container row is the
      // record; nothing else references it.
      await prisma.container.delete({ where: { id: row.id } });
      request.log.warn(
        { containerId: row.id, actor: request.user?.email },
        'container removed from pipeline'
      );
      return reply.code(204).send();
    }
  );

  /* --------------------------------------------------------------------- */
  /* Checklist library — the templates, not any one container               */
  /* --------------------------------------------------------------------- */
  app.get('/api/checklist-library', async (request, reply) =>
    reply.send({
      // Every template, including the variant-only ones, each carrying the
      // types it applies to so the library shows the whole picture.
      stages: STAGES.map((s) => ({
        ...s,
        tasks: TASKS_BY_STAGE[s.id].map((t) => ({
          key: t.key,
          label: t.label,
          hrs: t.hrs,
          onlyFor: t.onlyFor,
        })),
        budget: {
          standard: stageBudget('standard', s.id),
          double: stageBudget('double', s.id),
          anteroom: stageBudget('anteroom', s.id),
        },
      })),
      totals: {
        standard: totalPlanDays('standard'),
        double: totalPlanDays('double'),
        anteroom: totalPlanDays('anteroom'),
      },
      today: todayFor(request),
    })
  );
}
