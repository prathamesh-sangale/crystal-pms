import { env } from './env.js';
import { dedupeOrders, isStillOpenDelivered, toOmsOrder, type OmsOrder, type OmsOrderRaw } from './omsOrderSearch.js';

/**
 * Read-only client for OMS's public API (`GET /api/v1/orders`,
 * `GET /api/v1/orders/:ref`), used by Gate Out's order-number search.
 * PMS never writes anything to OMS: the key itself only has the `orders`
 * realm with `read:core` scope.
 *
 * Load on OMS is kept tiny on purpose:
 *  - the combined open-order list is cached for 5 minutes, and only refreshed
 *    when someone actually uses the lookup (no background polling);
 *  - every page request sends back the ETag OMS gave last time, so an
 *    unchanged page comes back as a bodiless 304;
 *  - one round is 1 page of `active` + about 5 pages of `delivered` at 200
 *    each, against a 600/minute limit on this key.
 * OMS's own data behind this endpoint is a snapshot it refreshes about
 * hourly, so a shorter cache here would gain nothing.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 200;
/** Safety cap: 20 pages x 200 = 4,000 orders per bucket, far above today's ~900. */
const MAX_PAGES = 20;
const TIMEOUT_MS = 10_000;

interface PageCacheEntry {
  etag: string;
  data: OmsOrderRaw[];
  total: number;
}

interface OmsListBody {
  data?: unknown;
  page?: { total?: number };
}

const pageCache = new Map<string, PageCacheEntry>();
let listCache: { orders: OmsOrder[]; fetchedAt: number } | null = null;
let inFlight: Promise<OmsOrder[]> | null = null;

export function omsConfigured(): boolean {
  return Boolean(env.OMS_API_URL && env.OMS_API_KEY);
}

function isRawOrder(value: unknown): value is OmsOrderRaw {
  return typeof value === 'object' && value !== null && typeof (value as { ref?: unknown }).ref === 'string';
}

async function omsGet(path: string, etag?: string): Promise<Response> {
  const headers: Record<string, string> = { 'X-API-Key': env.OMS_API_KEY ?? '', accept: 'application/json' };
  if (etag) headers['If-None-Match'] = etag;
  const base = (env.OMS_API_URL ?? '').replace(/\/+$/, '');
  return fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

async function fetchBucket(bucket: 'active' | 'delivered'): Promise<OmsOrderRaw[]> {
  const all: OmsOrderRaw[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    const key = `${bucket}:${offset}`;
    const cached = pageCache.get(key);
    const res = await omsGet(`/api/v1/orders?status=${bucket}&limit=${PAGE_LIMIT}&offset=${offset}`, cached?.etag);

    let entry: PageCacheEntry;
    if (res.status === 304 && cached) {
      entry = cached;
    } else if (res.ok) {
      const body = (await res.json()) as OmsListBody;
      const data = Array.isArray(body.data) ? body.data.filter(isRawOrder) : [];
      entry = { etag: res.headers.get('etag') ?? '', data, total: body.page?.total ?? data.length };
      if (entry.etag) pageCache.set(key, entry);
    } else {
      throw new Error(`OMS answered ${res.status} for the ${bucket} order list.`);
    }

    all.push(...entry.data);
    if (entry.data.length === 0 || offset + entry.data.length >= entry.total) break;
  }
  return all;
}

/**
 * Every order a container could be leaving on: all `active` orders, plus
 * `delivered` ones that still have units left to go (an order moves to
 * delivered at its first proof of delivery). On an OMS failure the last
 * good list is returned if there is one; otherwise the error is thrown.
 */
export async function getOpenOrders(): Promise<OmsOrder[]> {
  if (!omsConfigured()) return [];
  if (listCache && Date.now() - listCache.fetchedAt < CACHE_TTL_MS) return listCache.orders;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const [active, delivered] = await Promise.all([fetchBucket('active'), fetchBucket('delivered')]);
      const orders = dedupeOrders([
        ...active.map(toOmsOrder),
        ...delivered.map(toOmsOrder).filter(isStillOpenDelivered),
      ]);
      listCache = { orders, fetchedAt: Date.now() };
      return orders;
    } catch (err) {
      if (listCache) return listCache.orders;
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** One order by its exact number (any bucket), or null when OMS doesn't have it. */
export async function getOrder(ref: string): Promise<OmsOrder | null> {
  if (!omsConfigured()) return null;
  const res = await omsGet(`/api/v1/orders/${encodeURIComponent(ref)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OMS answered ${res.status} for order ${ref}.`);
  const body = (await res.json()) as { data?: unknown };
  return isRawOrder(body.data) ? toOmsOrder(body.data) : null;
}
