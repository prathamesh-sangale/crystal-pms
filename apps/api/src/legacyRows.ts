/**
 * Pure helpers that reproduce the legacy Apps Script Gate-In portal's sheet
 * formats and decisions, plus the safeguards agreed after the cross-system
 * audit (2026-11-24). No I/O here: legacySheets.ts does the reading and
 * writing, so every rule below is unit-testable.
 *
 * Shared sheets involved:
 *  - Gate ledger ("Yard Report" / "CONTAINER GATE-IN/ GATE-OUT"): one row per
 *    gate event, 32 values in the legacy `externalRow` order.
 *  - IMS "Master Sheet": on Gate In only, Status/Current = Stock, IN STOCK
 *    DATE, Location JNPT, Depot Crystal Yard New (exactly the legacy cells),
 *    but only from an "arriving" status and only on one unambiguous row.
 *  - Container_Repository (procurement workbook): Status MARKED GATE-IN/OUT.
 *  - Main portal auto-close: once per indent, only when it truly completes.
 */

export const LEDGER_STATUS_IN = 'Inward (Gate-In)';
export const LEDGER_STATUS_OUT = 'Outward (Gate-Out)';

/** PMS photo keys in the legacy column order (Left Side … Container Close-up). */
export const PHOTO_KEYS = ['leftSide', 'rightSide', 'backView', 'insideFront', 'insideRear', 'roof', 'floor', 'doorLock', 'closeUp'] as const;
export type PhotoKey = (typeof PHOTO_KEYS)[number];

/** The legacy portal's file-name suffix per photo, e.g. CXRU1040451_Left_Side. */
export const LEGACY_FILE_SUFFIX: Record<PhotoKey, string> = {
  leftSide: 'Left_Side',
  rightSide: 'Right_Side',
  backView: 'Back_View',
  insideFront: 'Inside_Front',
  insideRear: 'Inside_Rear',
  roof: 'Roof',
  floor: 'Floor',
  doorLock: 'Door_Lock',
  closeUp: 'Container_Close_up',
};

export function normalizeNo(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '');
}

/** Text that a sheet would read as a formula (=, +, -, @) is stored as plain text instead. */
export function safeCell(value: unknown): string {
  const s = String(value ?? '');
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n: number): string => String(n).padStart(2, '0');

/** "dd/MM/yyyy HH:mm:ss" in IST: the ledger's own Timestamp display (sheet locale en_GB). */
export function istDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** "dd-MM-yyyy" in IST: what the legacy portal writes into IMS's IN STOCK DATE. */
export function istDmy(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
}

/** A sheet serial date-time (days since 1899-12-30, in the sheet's IST zone) as epoch ms. */
export function serialToMs(serial: number): number {
  return Math.round((serial - 25569) * 86_400_000 - IST_OFFSET_MS);
}

/** "dd/mm/yyyy[ hh:mm[:ss]]" (IST) as epoch ms, or null. TMS writes its ledger timestamps as such text. */
export function dmyTextToMs(text: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = m;
  return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)) - IST_OFFSET_MS;
}

export interface GateEntryLike {
  kind: 'in' | 'out';
  loggedAt: string;
  loggedBy?: string;
  movementDate: string;
  orderNumber?: string;
  orderType?: string;
  customerName?: string;
  location?: string;
  transporterName?: string;
  transporterNumber?: string;
  vehicleNumber?: string;
  remarks?: string;
}

export interface LedgerLinks {
  photos: Partial<Record<PhotoKey, string>>;
  additional: string[];
  lrCopy: string;
  ptiVideo: string;
  pdf: string;
}

/**
 * One ledger row in the legacy portal's exact column order (32 values):
 * Timestamp, Email, Status, Date, Container No, Type, Size, Customer, Location,
 * Transporter Name, Transporter Number, Vehicle Number, LR Copy, 9 photos,
 * Repair Required?, Estimated budget, Remarks, Photo_Merge_Pdf, PTI CHECK,
 * PTI UPLOAD, Multiple photo Upload, Yard Location (JNPT Yard), Porta Cabin
 * checklist, Porta Cabin photos. Repair/PTI/cabin cells start blank: PMS asks
 * those in the survey, not at the gate.
 */
export function buildLedgerRow(
  container: { id: string; typeCode: string; size: string },
  entry: GateEntryLike,
  links: LedgerLinks,
  actorEmail: string
): string[] {
  const remarks = [entry.remarks?.trim() ?? ''];
  if (entry.kind === 'out' && entry.orderNumber?.trim()) {
    remarks.push(`Order: ${entry.orderNumber.trim()}${entry.orderType ? ` (${entry.orderType})` : ''}`);
  }
  return [
    istDateTime(entry.loggedAt),
    safeCell(entry.loggedBy?.trim() || actorEmail),
    entry.kind === 'in' ? LEDGER_STATUS_IN : LEDGER_STATUS_OUT,
    entry.movementDate,
    safeCell(container.id.trim()),
    safeCell(container.typeCode),
    safeCell(container.size),
    safeCell(entry.customerName ?? ''),
    safeCell(entry.location ?? ''),
    safeCell(entry.transporterName ?? ''),
    safeCell(entry.transporterNumber ?? ''),
    safeCell(entry.vehicleNumber ?? ''),
    links.lrCopy,
    ...PHOTO_KEYS.map((k) => links.photos[k] ?? ''),
    '',
    '',
    safeCell(remarks.filter(Boolean).join(' | ')),
    links.pdf,
    '',
    links.ptiVideo,
    links.additional.join(', '),
    'JNPT Yard',
    '',
    '',
  ];
}

// ---------------------------------------------------------------- IMS write

export interface ImsRowFull {
  rowNumber: number;
  containerNo: string;
  productType: string;
  depot: string;
  status: string;
  current: string;
}

export type ImsWriteDecision =
  | { write: true; row: ImsRowFull }
  | { write: false; outcome: 'not-found' | 'ambiguous' | 'already-stock' | 'hold'; detail: string };

function productTypeAsTypeCode(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (t === 'REEFER') return 'Reefer';
  if (t.startsWith('DRY')) return 'Dry';
  if (t === 'ISO' || t === 'ISO TANK') return 'ISO Tank';
  if (t === 'CCCS' || t === 'PORTA CABIN') return 'Porta Cabin';
  return null;
}

const isOurYard = (depot: string): boolean => depot.trim().toUpperCase().startsWith('CRYSTAL YARD');

/**
 * Safeguards 1 and 2 from the audit: write only to one unambiguous row, and
 * only from a status meaning "arriving" (In Transit, WIP, Offlease, blank) or
 * Stock at another depot (a transfer). Never over Blocked, Sale, Lease,
 * Trading, Held by Accounts, Dispute, Scrap, Machine*, Crystal Office or
 * "STOCK - Crystal Use": OMS and others read those as reservations.
 */
export function decideImsStockWrite(allRows: ImsRowFull[], containerNo: string, typeCode: string | null | undefined): ImsWriteDecision {
  const target = normalizeNo(containerNo);
  const rows = allRows.filter((r) => normalizeNo(r.containerNo) === target);
  if (rows.length === 0) return { write: false, outcome: 'not-found', detail: 'Container is not in IMS; nothing written.' };

  let candidates = rows;
  if (rows.length > 1 && typeCode) {
    const sameType = rows.filter((r) => productTypeAsTypeCode(r.productType)?.toLowerCase() === typeCode.toLowerCase());
    if (sameType.length > 0) candidates = sameType;
  }
  if (candidates.length !== 1) {
    return { write: false, outcome: 'ambiguous', detail: `IMS has ${candidates.length} rows for this container; nothing written. IMS owner to check.` };
  }
  const row = candidates[0]!;
  const current = (row.current.trim() || row.status.trim()).toUpperCase();

  if (current === 'STOCK' && isOurYard(row.depot)) {
    return { write: false, outcome: 'already-stock', detail: 'IMS already shows Stock at Crystal Yard; nothing to change.' };
  }
  const arriving = current === '' || current === 'WIP' || current === 'IN TRANSIT' || current.startsWith('OFFLEASE');
  const stockElsewhere = (current === 'STOCK' || current.startsWith('STOCK ')) && !isOurYard(row.depot);
  if (arriving || stockElsewhere) return { write: true, row };
  return {
    write: false,
    outcome: 'hold',
    detail: `IMS shows "${row.current || row.status}" (a hold or committed status); left unchanged. IMS owner to check.`,
  };
}

// ---------------------------------------------------- Container_Repository

export interface RepoRow {
  rowNumber: number;
  indentId: string;
  containerNo: string;
  status: string;
}

const isPlaceholder = (no: string): boolean => /\[WIP\]|UNASSIGNED/i.test(no);
const isMarked = (status: string): boolean => /MARKED/i.test(status);
const isDirectDelivery = (status: string): boolean => status.trim().toUpperCase() === 'STOCK - DIRECT DELIVERY';

export type RepoChoice = { row: RepoRow; newStatus: string } | { row: null; detail: string };

/**
 * Which Container_Repository row to mark. Gate In: an unmarked row for this
 * container (the indent typed on the gate form wins); never overwrite
 * "STOCK - DIRECT DELIVERY"; if every row is already marked, nothing (a
 * return must not re-trigger an old indent). Gate Out: the row currently
 * "MARKED GATE-IN".
 */
export function chooseRepoRow(rows: RepoRow[], containerNo: string, kind: 'in' | 'out', indentRef?: string): RepoChoice {
  const target = normalizeNo(containerNo);
  const mine = rows.filter((r) => normalizeNo(r.containerNo) === target && !isPlaceholder(r.containerNo));
  if (mine.length === 0) return { row: null, detail: 'Container is not in Container_Repository; nothing marked.' };
  const indent = indentRef?.trim();
  const prefer = (list: RepoRow[]): RepoRow | undefined => (indent ? list.find((r) => r.indentId.trim() === indent) : undefined) ?? list[0];

  if (kind === 'in') {
    const open = mine.filter((r) => !isMarked(r.status) && !isDirectDelivery(r.status));
    const row = prefer(open);
    if (!row) return { row: null, detail: 'Already marked (or a direct delivery) in Container_Repository; nothing changed.' };
    return { row, newStatus: 'MARKED GATE-IN' };
  }
  const gatedIn = mine.filter((r) => r.status.trim().toUpperCase() === 'MARKED GATE-IN');
  const row = prefer(gatedIn);
  if (!row) return { row: null, detail: 'No "MARKED GATE-IN" row for this container; nothing changed.' };
  return { row, newStatus: 'MARKED GATE-OUT' };
}

export interface IndentInfo {
  status: string;
  quantity: string;
}

export type AutoCloseDecision = { post: true; totalCount: number } | { post: false; detail: string };

/**
 * The legacy auto-close, made safe (audit): post only when this gate-in is
 * the one that completes the indent, the indent exists exactly once, isn't
 * already complete/cancelled/rejected, and the real container count reaches
 * the indent quantity. Direct deliveries count as arrived, like MARKED rows.
 * `rowsAfterMark` is every repository row of that indent, after our mark.
 */
export function decideAutoClose(rowsAfterMark: RepoRow[], indents: IndentInfo[], justMarked: boolean): AutoCloseDecision {
  if (!justMarked) return { post: false, detail: 'This gate-in did not mark a new repository row.' };
  if (indents.length !== 1) return { post: false, detail: `Indent found ${indents.length} times in Indents; not closed.` };
  const indent = indents[0]!;
  if (/pipeline complete|cancel|reject/i.test(indent.status)) return { post: false, detail: `Indent is already "${indent.status}".` };
  const real = rowsAfterMark.filter((r) => r.containerNo.trim() && !isPlaceholder(r.containerNo));
  const verified = real.filter((r) => isMarked(r.status) || isDirectDelivery(r.status));
  if (real.length === 0 || verified.length < real.length) {
    return { post: false, detail: `${verified.length} of ${real.length} containers arrived.` };
  }
  const qty = Number(String(indent.quantity).trim());
  if (!Number.isFinite(qty) || qty <= 0) return { post: false, detail: 'Indent quantity unreadable; not closed.' };
  if (real.length < qty) return { post: false, detail: `${real.length} containers attached but the indent is for ${qty}.` };
  return { post: true, totalCount: real.length };
}

// ------------------------------------------------ old portal -> PMS import

export interface LedgerEntryRow {
  rowNumber: number;
  timestampMs: number | null;
  email: string;
  status: string;
  date: string;
  containerNo: string;
  type: string;
  size: string;
  customer: string;
  location: string;
  transporterName: string;
  transporterNo: string;
  vehicleNo: string;
  lrCopy: string;
  photos: Partial<Record<PhotoKey, string>>;
  repairRequired: string;
  budget: string;
  remarks: string;
  pdf: string;
  ptiCheck: string;
  ptiVideo: string;
  additional: string[];
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Values read with UNFORMATTED_VALUE + SERIAL_NUMBER dates. */
export function parseLedgerRow(values: unknown[], rowNumber: number): LedgerEntryRow {
  const ts = values[0];
  const timestampMs = typeof ts === 'number' ? serialToMs(ts) : dmyTextToMs(str(ts));
  const dateRaw = values[3];
  const date = typeof dateRaw === 'number' ? new Date(serialToMs(dateRaw) + IST_OFFSET_MS).toISOString().slice(0, 10) : str(dateRaw);
  const photos: Partial<Record<PhotoKey, string>> = {};
  PHOTO_KEYS.forEach((k, i) => {
    const v = str(values[13 + i]);
    if (v) photos[k] = v;
  });
  return {
    rowNumber,
    timestampMs,
    email: str(values[1]),
    status: str(values[2]),
    date,
    containerNo: str(values[4]),
    type: str(values[5]),
    size: str(values[6]),
    customer: str(values[7]),
    location: str(values[8]),
    transporterName: str(values[9]),
    transporterNo: str(values[10]),
    vehicleNo: str(values[11]),
    lrCopy: str(values[12]),
    photos,
    repairRequired: str(values[22]),
    budget: str(values[23]),
    remarks: str(values[24]),
    pdf: str(values[25]),
    ptiCheck: str(values[26]),
    ptiVideo: str(values[27]),
    additional: str(values[28]).split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** TMS appends paired Inward/Outward rows for client-to-client moves that never pass the gate. */
export function isTmsSyntheticRow(row: Pick<LedgerEntryRow, 'remarks'>): boolean {
  const r = row.remarks.toLowerCase();
  return r.includes('never physically passed through a gate') || r.startsWith('auto ');
}

export type ImportPlan =
  | { action: 'create' }
  | { action: 'gate-out'; containerId: string }
  | { action: 'skip'; reason: string };

/**
 * What to do in PMS for one old-portal ledger row. Idempotent by PMS's own
 * state, so PMS's own ledger rows (and rows already imported) are skipped
 * naturally: an Inward for a container already in the PMS yard, or an
 * Outward for one PMS no longer has in the yard, needs nothing.
 * `active` / `departed` map normalised container numbers to PMS ids.
 */
export function planImport(row: LedgerEntryRow, active: Map<string, string>, departed: Map<string, string>): ImportPlan {
  const no = normalizeNo(row.containerNo);
  if (!no || !/^[A-Z]{3,}/.test(no)) return { action: 'skip', reason: 'No usable container number.' };
  if (isTmsSyntheticRow(row)) return { action: 'skip', reason: 'TMS row (container never passed the gate).' };
  if (row.status === LEDGER_STATUS_IN) {
    if (active.has(no)) return { action: 'skip', reason: 'Already in the PMS yard.' };
    if (departed.has(no)) return { action: 'skip', reason: 'Returning container: PMS re-entry is not supported yet.' };
    return { action: 'create' };
  }
  if (row.status === LEDGER_STATUS_OUT) {
    const id = active.get(no);
    if (!id) return { action: 'skip', reason: 'Not in the PMS yard; nothing to gate out.' };
    return { action: 'gate-out', containerId: id };
  }
  return { action: 'skip', reason: `Unknown status "${row.status}".` };
}
