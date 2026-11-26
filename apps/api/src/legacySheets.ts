import { google, type sheets_v4 } from 'googleapis';
import { env } from './env.js';
import { googleServiceAccountKey } from './googleAuth.js';
import {
  chooseRepoRow,
  decideAutoClose,
  decideImsStockWrite,
  normalizeNo,
  parseLedgerRow,
  type ImsRowFull,
  type LedgerEntryRow,
  type RepoRow,
} from './legacyRows.js';

/**
 * Reads and writes the legacy Gate-In portal's shared sheets for legacySync.ts.
 * Every write follows the audit's safeguards: header lookup (never fixed
 * letters), a fresh read right before writing, single cells only, the row's
 * container number verified before and after, never inserting, deleting or
 * sorting rows (the ledger is append-only). Only called while the matching
 * switch is on (see env.ts).
 */

const DEFAULT_IDS = {
  ledger: '1J4R3cfEX5FYgo8WqodufCCAzmlcNkpunRDp_jALTKl4',
  ims: '1qgAe0QOx93SRd8isBFCr5o1khnCBX0G2DM42nSuiRFo',
  repo: '1c1KJtLdULXttMV1F0GSry9om42InJGQXsX2xEQSygIU',
};
export const LEDGER_TAB = 'CONTAINER GATE-IN/ GATE-OUT';
const IMS_TAB = 'Master Sheet';
const REPO_TAB = 'Container_Repository';
const INDENTS_TAB = 'Indents';

export function legacyIds(): { ledger: string; ims: string; repo: string } {
  return {
    ledger: env.LEGACY_LEDGER_SHEET_ID || DEFAULT_IDS.ledger,
    ims: env.LEGACY_IMS_SHEET_ID || DEFAULT_IDS.ims,
    repo: env.LEGACY_REPO_SHEET_ID || DEFAULT_IDS.repo,
  };
}

let client: sheets_v4.Sheets | null = null;
function sheets(): sheets_v4.Sheets {
  if (client) return client;
  const key = googleServiceAccountKey();
  const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

export function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const q = (tab: string): string => `'${tab.replace(/'/g, "''")}'`;

async function getValues(spreadsheetId: string, range: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' = 'FORMATTED_VALUE'): Promise<unknown[][]> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render, dateTimeRenderOption: 'SERIAL_NUMBER' });
  return (res.data.values ?? []) as unknown[][];
}

function headerIndex(header: unknown[], names: string[]): Record<string, number> {
  const trimmed = header.map((h) => String(h ?? '').trim());
  const out: Record<string, number> = {};
  for (const n of names) {
    const i = trimmed.indexOf(n);
    if (i === -1) throw new Error(`Header "${n}" not found.`);
    out[n] = i;
  }
  return out;
}

export interface WriteResult {
  status: 'ok' | 'skipped';
  detail: string;
}

// ------------------------------------------------------------------ ledger

/** An identical event already in the last rows (a retry after a lost response) is reused, never re-appended. */
async function findExistingLedgerRow(containerId: string, status: string, timestampText: string): Promise<number | null> {
  const { ledger } = legacyIds();
  const colA = await getValues(ledger, `${q(LEDGER_TAB)}!A:A`);
  const last = colA.length;
  if (last < 2) return null;
  const from = Math.max(2, last - 80);
  const rows = await getValues(ledger, `${q(LEDGER_TAB)}!A${from}:E${last}`);
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (String(r[0] ?? '').trim() === timestampText && String(r[2] ?? '').trim() === status && normalizeNo(r[4]) === normalizeNo(containerId)) {
      return from + i;
    }
  }
  return null;
}

export async function appendLedgerRow(row: string[], containerId: string): Promise<number> {
  const { ledger } = legacyIds();
  const existing = await findExistingLedgerRow(containerId, row[2]!, row[0]!);
  if (existing) return existing;
  const res = await sheets().spreadsheets.values.append({
    spreadsheetId: ledger,
    range: `${q(LEDGER_TAB)}!A:AF`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  const m = /![A-Z]+(\d+)/.exec(res.data.updates?.updatedRange ?? '');
  if (!m) throw new Error('Ledger append did not report its row.');
  const rowNumber = Number(m[1]);
  const check = await getValues(ledger, `${q(LEDGER_TAB)}!E${rowNumber}`);
  if (normalizeNo(check[0]?.[0]) !== normalizeNo(containerId)) throw new Error(`Ledger row ${rowNumber} did not verify after append.`);
  return rowNumber;
}

/** The last `count` ledger rows, parsed (UNFORMATTED values, serial dates). */
export async function readLedgerTail(count: number): Promise<LedgerEntryRow[]> {
  const { ledger } = legacyIds();
  const colA = await getValues(ledger, `${q(LEDGER_TAB)}!A:A`);
  const last = colA.length;
  if (last < 2) return [];
  const from = Math.max(2, last - count + 1);
  const rows = await getValues(ledger, `${q(LEDGER_TAB)}!A${from}:AF${last}`, 'UNFORMATTED_VALUE');
  return rows.map((r, i) => parseLedgerRow(r, from + i));
}

// --------------------------------------------------------------------- IMS

export async function writeImsStock(containerId: string, typeCode: string, inStockDmy: string): Promise<WriteResult> {
  const { ims } = legacyIds();
  const header = (await getValues(ims, `${q(IMS_TAB)}!1:1`))[0] ?? [];
  const h = headerIndex(header, ['Container No', 'Product Type', 'Location', 'Depot', 'Status', 'Current', 'IN STOCK DATE']);
  const lastCol = colLetter(Math.max(...Object.values(h)));
  const body = await getValues(ims, `${q(IMS_TAB)}!A2:${lastCol}`);
  const rows: ImsRowFull[] = body.map((r, i) => ({
    rowNumber: i + 2,
    containerNo: String(r[h['Container No']!] ?? ''),
    productType: String(r[h['Product Type']!] ?? ''),
    depot: String(r[h['Depot']!] ?? ''),
    status: String(r[h['Status']!] ?? ''),
    current: String(r[h['Current']!] ?? ''),
  }));
  const decision = decideImsStockWrite(rows, containerId, typeCode);
  if (!decision.write) return { status: 'skipped', detail: decision.detail };

  const n = decision.row.rowNumber;
  const idCell = `${q(IMS_TAB)}!${colLetter(h['Container No']!)}${n}`;
  const before = await getValues(ims, idCell);
  if (normalizeNo(before[0]?.[0]) !== normalizeNo(containerId)) throw new Error(`IMS row ${n} changed before the write; nothing written.`);

  const cell = (col: string): string => `${q(IMS_TAB)}!${colLetter(h[col]!)}${n}`;
  await sheets().spreadsheets.values.batchUpdate({
    spreadsheetId: ims,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: cell('Status'), values: [['Stock']] },
        { range: cell('Current'), values: [['Stock']] },
        { range: cell('IN STOCK DATE'), values: [[inStockDmy]] },
        { range: cell('Location'), values: [['JNPT']] },
        { range: cell('Depot'), values: [['Crystal Yard New']] },
      ],
    },
  });
  const after = await getValues(ims, idCell);
  if (normalizeNo(after[0]?.[0]) !== normalizeNo(containerId)) {
    throw new Error(`IMS row ${n} no longer shows ${containerId} after the write. Check IMS row ${n} by hand.`);
  }
  return { status: 'ok', detail: `IMS row ${n}: "${decision.row.current || decision.row.status || 'blank'}" -> Stock at Crystal Yard New.` };
}

// ---------------------------------------------------- Container_Repository

export interface RepoMarkResult extends WriteResult {
  indentId?: string;
  justMarked: boolean;
  indentRows?: RepoRow[];
}

async function readRepo(): Promise<{ rows: RepoRow[]; h: Record<string, number> }> {
  const { repo } = legacyIds();
  const values = await getValues(repo, `${q(REPO_TAB)}!A1:P`);
  const h = headerIndex(values[0] ?? [], ['Indent_ID', 'Container_Number', 'Status']);
  const rows = values.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    indentId: String(r[h['Indent_ID']!] ?? '').trim(),
    containerNo: String(r[h['Container_Number']!] ?? '').trim(),
    status: String(r[h['Status']!] ?? '').trim(),
  }));
  return { rows, h };
}

export async function markRepository(containerId: string, kind: 'in' | 'out', indentRef?: string): Promise<RepoMarkResult> {
  const { repo } = legacyIds();
  const { rows, h } = await readRepo();
  const choice = chooseRepoRow(rows, containerId, kind, indentRef);
  if (!choice.row) return { status: 'skipped', detail: choice.detail, justMarked: false };

  const n = choice.row.rowNumber;
  const idCell = `${q(REPO_TAB)}!${colLetter(h['Container_Number']!)}${n}`;
  const before = await getValues(repo, idCell);
  if (normalizeNo(before[0]?.[0]) !== normalizeNo(containerId)) throw new Error(`Container_Repository row ${n} changed before the write; nothing written.`);
  await sheets().spreadsheets.values.update({
    spreadsheetId: repo,
    range: `${q(REPO_TAB)}!${colLetter(h['Status']!)}${n}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[choice.newStatus]] },
  });
  const indentRows = rows
    .filter((r) => r.indentId === choice.row.indentId)
    .map((r) => (r.rowNumber === n ? { ...r, status: choice.newStatus } : r));
  return { status: 'ok', detail: `Container_Repository row ${n} (indent ${choice.row.indentId}): ${choice.newStatus}.`, indentId: choice.row.indentId, justMarked: true, indentRows };
}

// ------------------------------------------------------------- auto-close

export async function autoCloseIfComplete(indentId: string, indentRows: RepoRow[], justMarked: boolean): Promise<WriteResult> {
  const { repo } = legacyIds();
  const values = await getValues(repo, `${q(INDENTS_TAB)}!A1:AZ`);
  const h = headerIndex(values[0] ?? [], ['Indent_ID', 'Status', 'Quantity']);
  const indents = values
    .slice(1)
    .filter((r) => String(r[h['Indent_ID']!] ?? '').trim() === indentId)
    .map((r) => ({ status: String(r[h['Status']!] ?? ''), quantity: String(r[h['Quantity']!] ?? '') }));
  const decision = decideAutoClose(indentRows, indents, justMarked);
  if (!decision.post) return { status: 'skipped', detail: decision.detail };
  if (!env.LEGACY_AUTOCLOSE_URL) return { status: 'skipped', detail: 'Indent complete, but no auto-close URL is set.' };

  const res = await fetch(env.LEGACY_AUTOCLOSE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'auto_close_pipeline', indentId, totalCount: decision.totalCount }),
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let parsed: { success?: unknown } | null = null;
  try {
    parsed = JSON.parse(text) as { success?: unknown };
  } catch {
    parsed = null;
  }
  if (parsed?.success === true) return { status: 'ok', detail: `Indent ${indentId} auto-closed (${decision.totalCount} containers).` };
  throw new Error(`Auto-close not confirmed (HTTP ${res.status}): ${text.slice(0, 120)}`);
}
