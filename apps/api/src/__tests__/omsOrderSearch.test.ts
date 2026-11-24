/**
 * Pure-function tests for the Gate Out OMS order lookup. No network: orders
 * are built in memory, so this file is always safe to run.
 */
import { describe, expect, it } from 'vitest';
import {
  dedupeOrders,
  isStillOpenDelivered,
  orderTypeCategory,
  ordersForContainer,
  searchOrders,
  toOmsOrder,
  type OmsOrder,
} from '../omsOrderSearch.js';

const order = (ref: string, over: Partial<OmsOrder> = {}): OmsOrder => ({
  ref,
  status: 'active',
  transactionType: 'Sale',
  orderType: 'Sale',
  product: null,
  stage: null,
  quantity: 1,
  deliveredQty: 0,
  containers: [],
  ...over,
});

describe('orderTypeCategory', () => {
  it('maps OMS free-text transaction types onto Lease / Sale / AMC / Other', () => {
    expect(orderTypeCategory('Lease')).toBe('Lease');
    expect(orderTypeCategory(' lease ')).toBe('Lease');
    expect(orderTypeCategory('Sale')).toBe('Sale');
    expect(orderTypeCategory('Tender')).toBe('Sale');
    expect(orderTypeCategory('AMC')).toBe('AMC');
    expect(orderTypeCategory('CMC')).toBe('AMC');
    expect(orderTypeCategory('PM')).toBe('AMC');
    for (const other of ['Spares', 'Transportation', 'Logistic', 'Service - Visit Charges', '', null, undefined]) {
      expect(orderTypeCategory(other)).toBe('Other');
    }
  });
});

describe('toOmsOrder', () => {
  it('normalises containers and keeps the raw transaction type', () => {
    const o = toOmsOrder({ ref: ' OR640 ', transactionType: 'Tender', containers: ['criu 4025575', 'SITECABIN52'], quantity: 3, deliveredQty: 2 });
    expect(o.ref).toBe('OR640');
    expect(o.transactionType).toBe('Tender');
    expect(o.orderType).toBe('Sale');
    expect(o.containers).toEqual(['CRIU4025575', 'SITECABIN52']);
  });

  it('treats a missing containers list as empty', () => {
    expect(toOmsOrder({ ref: 'OR1', containers: null }).containers).toEqual([]);
  });
});

describe('isStillOpenDelivered', () => {
  it('keeps genuinely part-delivered orders only', () => {
    expect(isStillOpenDelivered({ quantity: 3, deliveredQty: 2, status: 'delivered' })).toBe(true);
    expect(isStillOpenDelivered({ quantity: 2, deliveredQty: 2, status: 'delivered' })).toBe(false);
    expect(isStillOpenDelivered({ quantity: null, deliveredQty: 1, status: 'delivered' })).toBe(false);
  });

  it('drops delivered orders with no recorded delivery count, and closed ones', () => {
    expect(isStillOpenDelivered({ quantity: 1, deliveredQty: 0, status: 'delivered' })).toBe(false);
    expect(isStillOpenDelivered({ quantity: 3, deliveredQty: 1, status: 'closed' })).toBe(false);
  });
});

describe('searchOrders', () => {
  const orders = [order('OR64'), order('OR640'), order('OR564'), order('OR6'), order('QAS0042')];

  it('accepts "64", "or-64" and "OR64" alike, exact match first, then prefix, then contains', () => {
    for (const q of ['64', 'or-64', 'OR64', ' Or 64 ']) {
      expect(searchOrders(orders, q).map((o) => o.ref), q).toEqual(['OR64', 'OR640', 'OR564']);
    }
  });

  it('matches non-OR refs on their whole text', () => {
    expect(searchOrders(orders, 'qas004').map((o) => o.ref)).toEqual(['QAS0042']);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchOrders(orders, '  ')).toEqual([]);
    expect(searchOrders(orders, '6', 2)).toHaveLength(2);
  });
});

describe('ordersForContainer', () => {
  it('finds every order a container is allocated to, ignoring spaces and case', () => {
    const orders = [order('OR1', { containers: ['CRIU4025575'] }), order('OR2', { containers: ['TGHU1234567'] })];
    expect(ordersForContainer(orders, 'criu 4025575').map((o) => o.ref)).toEqual(['OR1']);
    expect(ordersForContainer(orders, '')).toEqual([]);
  });
});

describe('dedupeOrders', () => {
  it('keeps the first copy of each ref', () => {
    const a = order('OR1', { stage: 'active copy' });
    const b = order('or1', { stage: 'delivered copy' });
    expect(dedupeOrders([a, b])).toEqual([a]);
  });
});
