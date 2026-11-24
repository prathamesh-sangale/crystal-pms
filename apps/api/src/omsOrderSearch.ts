/**
 * Pure helpers for the Gate Out order lookup against OMS's public API
 * (`omsClient.ts` does the actual fetching). No network, no env, no I/O, so
 * every rule here is unit-testable on its own.
 *
 * OMS facts these helpers rely on, confirmed with the OMS side (2026-11-24):
 *  - `transactionType` is free text from the order punch, not a fixed list.
 *    Values in use: Sale, Lease, Spares, Tender, AMC, Transportation, PM,
 *    Logistic, CMC, "Service - Visit Charges", and sometimes null.
 *  - `containers` is the order's allocated list: uppercase, no spaces, `[]`
 *    when nothing is allocated yet (only 9 of 64 active orders had any).
 *    A container is occasionally dispatched without being on that list, so a
 *    mismatch is only ever a warning, never a block.
 *  - An order moves to the "delivered" bucket at its FIRST proof of delivery,
 *    even when more units still have to leave, so delivered orders still
 *    count as open while deliveredQty < quantity.
 */

export type OrderTypeCategory = 'Lease' | 'Sale' | 'AMC' | 'Other';

export const ORDER_TYPE_CATEGORIES: OrderTypeCategory[] = ['Lease', 'Sale', 'AMC', 'Other'];

/** The subset of OMS's `projectOrder` fields this app uses (read:core scope). */
export interface OmsOrderRaw {
  ref: string;
  transactionType?: string | null;
  product?: string | null;
  stage?: string | null;
  status?: string | null;
  quantity?: number | null;
  deliveredQty?: number | null;
  containers?: string[] | null;
}

export interface OmsOrder {
  ref: string;
  /** OMS's own lifecycle status, e.g. "active", "delivered", "closed". */
  status: string | null;
  /** OMS's own value, verbatim (or null). */
  transactionType: string | null;
  /** This app's four-way grouping of `transactionType`, for the Order Type dropdown. */
  orderType: OrderTypeCategory;
  product: string | null;
  stage: string | null;
  quantity: number | null;
  deliveredQty: number | null;
  /** Normalised (uppercase, no spaces). */
  containers: string[];
}

/** Container numbers compared the same way everywhere: uppercase, all whitespace removed. */
export function normalizeContainerNo(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

/** Lease -> Lease; Sale and Tender -> Sale; AMC, CMC and PM -> AMC; anything else -> Other. */
export function orderTypeCategory(transactionType: string | null | undefined): OrderTypeCategory {
  const t = (transactionType ?? '').trim().toUpperCase();
  if (t === 'LEASE') return 'Lease';
  if (t === 'SALE' || t === 'TENDER') return 'Sale';
  if (t === 'AMC' || t === 'CMC' || t === 'PM') return 'AMC';
  return 'Other';
}

export function toOmsOrder(raw: OmsOrderRaw): OmsOrder {
  const transactionType = raw.transactionType?.trim() || null;
  return {
    ref: raw.ref.trim(),
    status: raw.status?.trim() || null,
    transactionType,
    orderType: orderTypeCategory(transactionType),
    product: raw.product ?? null,
    stage: raw.stage ?? null,
    quantity: typeof raw.quantity === 'number' ? raw.quantity : null,
    deliveredQty: typeof raw.deliveredQty === 'number' ? raw.deliveredQty : null,
    containers: (raw.containers ?? []).map(normalizeContainerNo).filter(Boolean),
  };
}

/**
 * A delivered-bucket order is still open only while it is genuinely PART
 * delivered: at least one unit delivered, fewer than ordered, and not closed.
 * Checked live (2026-11-24): of 818 delivered orders, 231 showed
 * deliveredQty < quantity, but 147 of those had deliveredQty 0 (old orders
 * OMS never recorded a delivery count for) and 2 were closed. Only the 84
 * real part-deliveries belong in suggestions; any other order can still be
 * found by typing its exact number.
 */
export function isStillOpenDelivered(order: Pick<OmsOrder, 'quantity' | 'deliveredQty' | 'status'>): boolean {
  if (order.quantity === null || order.deliveredQty === null) return false;
  if ((order.status ?? '').toLowerCase() === 'closed') return false;
  return order.deliveredQty > 0 && order.deliveredQty < order.quantity;
}

/** The comparable core of an order number: "OR640", "or-640", "Or 640" and "640" all become "640". */
function refKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OR/, '');
}

/**
 * Orders whose number matches what's been typed so far. An exact match comes
 * first, then numbers starting with the typed digits, then numbers merely
 * containing them. A ref that isn't an "OR…" number (e.g. "QAS0042") is
 * matched on its whole text the same way.
 */
export function searchOrders(orders: OmsOrder[], query: string, limit = 20): OmsOrder[] {
  const q = refKey(query);
  if (!q) return [];
  const scored: Array<{ order: OmsOrder; rank: number }> = [];
  for (const order of orders) {
    const key = refKey(order.ref);
    if (key === q) scored.push({ order, rank: 0 });
    else if (key.startsWith(q)) scored.push({ order, rank: 1 });
    else if (key.includes(q)) scored.push({ order, rank: 2 });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || a.order.ref.localeCompare(b.order.ref, undefined, { numeric: true }))
    .slice(0, limit)
    .map((s) => s.order);
}

/** Every open order this container is allocated to in OMS. */
export function ordersForContainer(orders: OmsOrder[], containerId: string): OmsOrder[] {
  const target = normalizeContainerNo(containerId);
  if (!target) return [];
  return orders.filter((o) => o.containers.includes(target));
}

/** One order per ref; a later entry (e.g. the delivered copy) never duplicates an earlier one. */
export function dedupeOrders(orders: OmsOrder[]): OmsOrder[] {
  const seen = new Set<string>();
  const out: OmsOrder[] = [];
  for (const o of orders) {
    const key = o.ref.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}
