/**
 * The Gate In / Gate Out rules, decided from IMS's own "Master Sheet" status
 * (agreed with the owner 2026-11-24). Pure functions: the caller reads the
 * rows (imsLookup.ts, read-only) and passes them in, so nothing here can
 * write anywhere.
 *
 * Gate In is refused only when IMS already shows the container as plain
 * Stock at our own yard (any "Crystal Yard…" depot spelling). "STOCK -
 * Crystal Use" at our yard is allowed with a warning. Every other status
 * (OFFLEASE, WIP, In Transit, not in IMS at all, …) is allowed; Stock at
 * another depot is allowed with a warning, since that's a transfer in.
 *
 * Gate Out is allowed when IMS shows Stock, Blocked, LEASE, SALE or TRADING
 * (in stock, or assigned to an order). OMS moves a container to LEASE/SALE
 * *before* it physically leaves (4 of the 23 containers in the PMS yard
 * already showed LEASE when checked), so those must stay allowed. OFFLEASE
 * is allowed with a warning. Anything else (WIP, In Transit, Scrap, …) is
 * refused.
 *
 * Both rules fail OPEN: if IMS can't be read, or the container isn't in IMS,
 * the gate entry goes through with a warning. A Google outage must never
 * stop the gate.
 */

export interface ImsStatusRow {
  containerNo: string;
  productType: string;
  depot: string;
  /** Master Sheet column M. */
  current: string;
  /** Master Sheet column L, used only when Current is blank. */
  status: string;
}

export interface GateDecision {
  allowed: boolean;
  /** Why it was refused; set only when `allowed` is false. */
  reason: string | null;
  warnings: string[];
}

export function isOurYardDepot(depot: string): boolean {
  return depot.trim().toUpperCase().startsWith('CRYSTAL YARD');
}

function effectiveStatus(row: ImsStatusRow): string {
  return (row.current.trim() || row.status.trim()).toUpperCase();
}

function isStockStatus(status: string): boolean {
  return status === 'STOCK' || status.startsWith('STOCK ');
}

/** Stock (incl. "STOCK - Crystal Use"), anything Blocked, LEASE, SALE, TRADING. */
function isGateOutStatus(status: string): boolean {
  if (isStockStatus(status)) return true;
  if (status.includes('BLOCKED')) return true;
  return status === 'LEASE' || status === 'SALE' || status === 'TRADING';
}

/** IMS's Product Type in this app's Type vocabulary (same mapping as imsLookup's `mapType`). */
function productTypeAsTypeCode(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (t === 'REEFER') return 'Reefer';
  if (t.startsWith('DRY')) return 'Dry';
  if (t === 'ISO' || t === 'ISO TANK') return 'ISO Tank';
  if (t === 'CCCS') return 'Porta Cabin';
  return null;
}

/**
 * The same container number can sit on two IMS rows for two different
 * physical units (e.g. one Dry, one Reefer). When the gate form's Type
 * matches some of those rows, only those count. When it matches none (or
 * no type is known), all rows count, so a real Stock row is never ignored.
 */
export function rowsForType(rows: ImsStatusRow[], typeCode: string | null | undefined): ImsStatusRow[] {
  if (!typeCode || rows.length <= 1) return rows;
  const wanted = typeCode.trim().toLowerCase();
  const sameType = rows.filter((r) => productTypeAsTypeCode(r.productType)?.toLowerCase() === wanted);
  return sameType.length > 0 ? sameType : rows;
}

function describe(row: ImsStatusRow): string {
  const status = row.current.trim() || row.status.trim() || 'no status';
  return `${status} at ${row.depot.trim() || 'no depot'}`;
}

export function evaluateGateIn(allRows: ImsStatusRow[], typeCode?: string | null): GateDecision {
  const rows = rowsForType(allRows, typeCode);
  if (rows.length === 0) {
    return { allowed: true, reason: null, warnings: ['Not found in IMS, so IMS could not confirm it. Gate-in allowed.'] };
  }
  const stockHere = rows.filter((r) => effectiveStatus(r) === 'STOCK' && isOurYardDepot(r.depot));
  if (stockHere.length > 0) {
    return {
      allowed: false,
      reason: `IMS already shows this container in stock at our yard (${stockHere.map(describe).join('; ')}). It has to be gated out before it can be gated in again.`,
      warnings: [],
    };
  }
  const warnings: string[] = [];
  // "STOCK - Crystal Use" at our yard is a warning, not a block (owner's
  // decision, 2026-11-24).
  const crystalUseHere = rows.filter((r) => isStockStatus(effectiveStatus(r)) && isOurYardDepot(r.depot));
  if (crystalUseHere.length > 0) {
    warnings.push(`IMS shows this container as ${crystalUseHere.map(describe).join('; ')}. Gate-in allowed; check IMS.`);
  }
  const stockElsewhere = rows.filter((r) => isStockStatus(effectiveStatus(r)) && !isOurYardDepot(r.depot));
  if (stockElsewhere.length > 0) {
    warnings.push(`IMS shows this container in stock at another depot (${stockElsewhere.map(describe).join('; ')}). Treating it as a transfer in.`);
  }
  return { allowed: true, reason: null, warnings };
}

export function evaluateGateOut(allRows: ImsStatusRow[], typeCode?: string | null): GateDecision {
  const rows = rowsForType(allRows, typeCode);
  if (rows.length === 0) {
    return { allowed: true, reason: null, warnings: ['Not found in IMS, so IMS could not confirm it. Gate-out allowed.'] };
  }
  if (rows.some((r) => isGateOutStatus(effectiveStatus(r)))) {
    return { allowed: true, reason: null, warnings: [] };
  }
  // Offlease is a warning, not a block (owner's decision, 2026-11-24): LMS and
  // TMS often set it before the container is physically back, so IMS can lag
  // behind the yard (e.g. CCLU1030700).
  const offlease = rows.filter((r) => effectiveStatus(r).startsWith('OFFLEASE'));
  if (offlease.length > 0) {
    return {
      allowed: true,
      reason: null,
      warnings: [`IMS still shows this container as ${offlease.map(describe).join('; ')}. Gate-out allowed; IMS may need updating.`],
    };
  }
  return {
    allowed: false,
    reason: `IMS shows this container as ${rows.map(describe).join('; ')}. Gate-out needs IMS to show Stock, Blocked, LEASE, SALE or TRADING.`,
    warnings: [],
  };
}

/** Used when IMS can't be read at all: never block the gate on a Google outage. */
export function imsUnavailableDecision(kind: 'in' | 'out'): GateDecision {
  return {
    allowed: true,
    reason: null,
    warnings: [`Couldn't reach IMS to check this container. Gate-${kind} allowed.`],
  };
}
