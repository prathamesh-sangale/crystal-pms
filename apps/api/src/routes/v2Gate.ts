import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScreen } from '../auth.js';
import { checkGate, gateRulesEnabled } from '../gateCheck.js';
import { parseOr422 } from '../http.js';
import { getOpenOrders, getOrder, omsConfigured } from '../omsClient.js';
import { ordersForContainer, searchOrders, type OmsOrder } from '../omsOrderSearch.js';

const omsQuerySchema = z.object({
  q: z.string().max(40).optional(),
  containerId: z.string().max(40).optional(),
});

const gateCheckQuerySchema = z.object({
  kind: z.enum(['in', 'out']),
  containerId: z.string().min(1).max(40),
  typeCode: z.string().max(40).optional(),
});

/** "OR-640" / "or 640" -> "OR640"; null unless it looks like a whole order number. */
function exactRefCandidate(q: string): string | null {
  const ref = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]+\d+$/.test(ref) ? ref : null;
}

/**
 * Two read-only helpers for the gate form:
 *  - `/api/v2/oms/orders`: Gate Out's order-number search against OMS
 *    (reads OMS only, through a read:core key).
 *  - `/api/v2/gate-check`: the IMS-based Gate In / Gate Out rule (reads IMS
 *    only). Answers `{ enabled: false }` while GATE_RULES_ENABLED isn't
 *    "true", so the form behaves exactly as before.
 * Neither route writes anything, anywhere.
 */
export async function v2GateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.get('/api/v2/oms/orders', { preHandler: requireScreen('live', 'yard') }, async (request, reply) => {
    const query = await parseOr422(omsQuerySchema, request.query, reply);
    if (!query) return;
    if (!omsConfigured()) return reply.send({ enabled: false, available: false, orders: [], forContainer: [] });

    try {
      const open = await getOpenOrders();
      let orders: OmsOrder[] = query.q ? searchOrders(open, query.q) : [];
      // Not among the open orders (e.g. an order delivered in full): ask OMS for that exact number.
      const exact = query.q ? exactRefCandidate(query.q) : null;
      if (orders.length === 0 && exact) {
        const one = await getOrder(exact).catch(() => null);
        if (one) orders = [one];
      }
      const forContainer = query.containerId ? ordersForContainer(open, query.containerId) : [];
      return reply.send({ enabled: true, available: true, orders, forContainer });
    } catch (err) {
      request.log.warn({ err }, 'OMS order lookup failed');
      return reply.send({ enabled: true, available: false, orders: [], forContainer: [] });
    }
  });

  app.get('/api/v2/gate-check', { preHandler: requireScreen('live', 'yard') }, async (request, reply) => {
    const query = await parseOr422(gateCheckQuerySchema, request.query, reply);
    if (!query) return;
    if (!gateRulesEnabled()) return reply.send({ enabled: false, allowed: true, reason: null, warnings: [] });
    const decision = await checkGate(query.kind, query.containerId, query.typeCode, request.log);
    return reply.send({ enabled: true, ...decision });
  });
}
