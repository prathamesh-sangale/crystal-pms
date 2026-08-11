import {
  ANTEROOM_VARIANTS,
  CONTAINER_SIZES,
  CONTAINER_TYPES,
  PRIORITIES,
  STAGES,
  TYPE_HINTS,
  TYPE_LABELS,
} from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { prisma } from '../db.js';
import { toOffLease, toOrder } from '../mappers.js';
import { todayFor } from '../today.js';

/**
 * Everything a form needs to render: the depot list, the technician roster and
 * their named cover, and the fixed vocabularies. One request, so a modal never
 * opens with empty dropdowns.
 */
export async function referenceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/reference', async (request, reply) => {
    const [depots, technicians] = await Promise.all([
      prisma.depot.findMany({ orderBy: [{ isHome: 'desc' }, { name: 'asc' }] }),
      prisma.technician.findMany({
        where: { active: true },
        include: { backup: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return reply.send({
      depots: depots.map((d) => ({
        id: d.id,
        name: d.name,
        isHome: d.isHome,
        location: d.location,
      })),
      homeDepot: depots.find((d) => d.isHome)?.name ?? depots[0]?.name ?? '',
      technicians: technicians.map((t) => ({
        name: t.name,
        trade: t.trade,
        backup: t.backup?.name ?? null,
      })),
      stages: STAGES,
      types: CONTAINER_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t], hint: TYPE_HINTS[t] })),
      sizes: CONTAINER_SIZES,
      priorities: PRIORITIES,
      anteroomVariants: ANTEROOM_VARIANTS,
      today: todayFor(request),
    });
  });

  app.get('/api/off-lease', async (request, reply) => {
    const rows = await prisma.offLeaseUnit.findMany({
      include: { depot: true },
      orderBy: { expected: 'asc' },
    });
    return reply.send({ offLease: rows.map(toOffLease), today: todayFor(request) });
  });

  app.get('/api/orders', async (request, reply) => {
    const rows = await prisma.customerOrder.findMany({ orderBy: { needBy: 'asc' } });
    return reply.send({ orders: rows.map(toOrder), today: todayFor(request) });
  });
}
