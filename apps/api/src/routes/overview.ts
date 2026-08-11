import {
  STAGES,
  isLate,
  isReady,
  matchOrders,
  overallProgress,
  totalPlanDaysFor,
} from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { prisma } from '../db.js';
import { containerInclude, toContainer, toOffLease, toOrder } from '../mappers.js';
import { todayFor } from '../today.js';

/**
 * The aggregate behind Depot Command and the Dashboard.
 *
 * Computed on the server so every screen sees the same numbers, and so the
 * phone does not download the whole fleet to render four stat cards.
 */
export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/overview', async (request, reply) => {
    const today = todayFor(request);

    const [rows, depotRows, offLeaseRows, orderRows] = await Promise.all([
      prisma.container.findMany({ include: containerInclude }),
      prisma.depot.findMany({ orderBy: [{ isHome: 'desc' }, { name: 'asc' }] }),
      prisma.offLeaseUnit.findMany({ include: { depot: true }, orderBy: { expected: 'asc' } }),
      prisma.customerOrder.findMany({ orderBy: { needBy: 'asc' } }),
    ]);

    const containers = rows.map(toContainer);
    const offLease = offLeaseRows.map(toOffLease);
    const orders = orderRows.map(toOrder);
    const homeDepot = depotRows.find((d) => d.isHome)?.name ?? depotRows[0]?.name ?? '';

    const home = containers.filter((c) => c.depot === homeDepot);
    const matches = matchOrders(orders, containers, homeDepot);

    const depots = depotRows.map((d) => {
      const fleet = containers.filter((c) => c.depot === d.name);
      return {
        name: d.name,
        location: d.location,
        isHome: d.isHome,
        total: fleet.length,
        ready: fleet.filter(isReady).length,
        late: fleet.filter((c) => isLate(c, today)).length,
        averageProgress: fleet.length
          ? Math.round(fleet.reduce((a, c) => a + overallProgress(c), 0) / fleet.length)
          : 0,
      };
    });

    const stages = STAGES.map((s) => ({
      id: s.id,
      name: s.name,
      days: s.days,
      desc: s.desc,
      count: containers.filter((c) => c.stage === s.id).length,
      late: containers.filter((c) => c.stage === s.id && isLate(c, today)).length,
    }));

    const averagePlannedTurnaround = containers.length
      ? Math.round(containers.reduce((a, c) => a + totalPlanDaysFor(c), 0) / containers.length)
      : 0;

    return reply.send({
      today,
      homeDepot,
      containers,
      offLease,
      orders,
      matches: matches.map((m) => ({
        order: m.order,
        containerId: m.container?.id ?? null,
        remaining: m.remaining?.length ?? null,
        ready: m.ready,
        elsewhereCount: m.elsewhereCount,
        status: m.status,
      })),
      depots,
      stages,
      totals: {
        fleet: containers.length,
        home: home.length,
        homeReady: home.filter(isReady).length,
        homeLate: home.filter((c) => isLate(c, today)).length,
        active: containers.filter((c) => !isReady(c)).length,
        late: containers.filter((c) => isLate(c, today)).length,
        ready: containers.filter(isReady).length,
        double: containers.filter((c) => c.type === 'double').length,
        anteroom: containers.filter((c) => c.type === 'anteroom').length,
        offLeaseIncoming: offLease.length,
        offLeaseHeavy: offLease.filter((o) => o.grade === 'C' || o.grade === 'D').length,
        orders: orders.length,
        ordersReady: matches.filter((m) => m.ready).length,
        ordersUnmatched: matches.filter((m) => !m.container).length,
        averagePlannedTurnaround,
      },
    });
  });
}
