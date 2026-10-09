import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google, type sheets_v4 } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The real IMS's own spreadsheet — read-only, same service account already
 * used for the Sheets export and Drive uploads. There is no write path
 * anywhere in this module, and there must never be one: nothing in this app
 * is allowed to write back to IMS, by explicit instruction. */
const IMS_SPREADSHEET_ID = '1qgAe0QOx93SRd8isBFCr5o1khnCBX0G2DM42nSuiRFo';
const IMS_TAB = 'Container Finder';
const CACHE_TTL_MS = 5 * 60 * 1000;

/** This app now only concerns itself with containers at this one yard —
 * not the whole JNPT port (other depots, e.g. "BCT Depot", also sit there)
 * and not IMS's other locations (Kolkata, Chhattisgarh, etc). A match at a
 * different depot is never offered for pre-fill, but it isn't thrown away
 * either — see `elsewhere` on `ImsLookupResult`. */
const OUR_DEPOT = 'CRYSTAL YARD';

let client: sheets_v4.Sheets | null = null;

function sheets(): sheets_v4.Sheets {
  if (client) return client;
  const keyPath = path.join(__dirname, '..', 'credentials', 'google-service-account.json');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

export interface ImsMatch {
  containerId: string;
  imsType: string;
  imsSize: string;
  depot: string;
  status: string;
  grade: string;
  /** Best-effort guess at this depot's own Type/Size dropdown values, for
   * pre-filling the Gate-In form — `null` when IMS's own value (its Type
   * column alone has at least 8 distinct, inconsistently-cased spellings,
   * e.g. "CONTAINER"/"CCCS") doesn't map confidently onto anything. Always
   * just a suggestion: the admin sees and can override it like any other
   * field, never a locked-in value. */
  suggestedTypeCode: string | null;
  suggestedSize: string | null;
}

interface ImsRow extends ImsMatch {
  normalizedId: string;
}

let cache: { rows: ImsRow[]; fetchedAt: number } | null = null;

/** Case/whitespace-insensitive, since IMS's own data has the same container
 * number written both with and without an internal space across different
 * tabs (observed directly: "BHCU4961252" vs "BHCU 4961252"). */
function normalize(id: string): string {
  return id.toUpperCase().replace(/\s+/g, '');
}

function mapType(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  if (t === 'REEFER') return 'Reefer';
  if (t === 'DRY') return 'Dry';
  if (t === 'ISO' || t === 'ISO TANK') return 'ISO Tank';
  return null;
}

function mapSize(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === '10FT') return '10 Feet';
  if (s === '20FT' || s === '20GP') return '20 Feet';
  if (s === '40FT' || s === '40HC') return '40 Feet';
  return null;
}

async function loadRows(): Promise<ImsRow[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;

  const res = await sheets().spreadsheets.values.get({
    spreadsheetId: IMS_SPREADSHEET_ID,
    range: `'${IMS_TAB}'!A1:Z`,
  });
  const values = res.data.values ?? [];

  // The sheet's own row 1 is blank; the real header is row 2 — found by
  // content, not a hardcoded row number, so a future blank-row change on
  // their end doesn't silently break this.
  const headerIndex = values.findIndex((row) => row[0] === 'Container Number');
  if (headerIndex === -1) throw new Error(`Could not find the header row in the IMS sheet's "${IMS_TAB}" tab.`);
  const header = values[headerIndex]!;
  const col = (name: string): number => header.indexOf(name);
  const idCol = col('Container Number');
  const typeCol = col('Type');
  const sizeCol = col('Size');
  const depotCol = col('Depot');
  const statusCol = col('Status');
  const gradeCol = col('Grade');

  const rows: ImsRow[] = [];
  for (const row of values.slice(headerIndex + 1)) {
    const rawId = row[idCol];
    if (!rawId) continue;
    const imsType = row[typeCol] ?? '';
    const imsSize = row[sizeCol] ?? '';
    rows.push({
      containerId: rawId,
      normalizedId: normalize(rawId),
      imsType,
      imsSize,
      depot: (row[depotCol] ?? '').trim(),
      status: (row[statusCol] ?? '').trim(),
      grade: (row[gradeCol] ?? '').trim(),
      suggestedTypeCode: mapType(imsType),
      suggestedSize: mapSize(imsSize),
    });
  }

  cache = { rows, fetchedAt: Date.now() };
  return rows;
}

export interface ImsLookupResult {
  /** Candidates at our own yard — these are the only ones ever offered for
   * pre-fill or picked from. */
  matches: ImsMatch[];
  /** Same container number, but found at a different depot — never
   * pre-filled (it's very likely a different physical unit, or simply not
   * relevant to us), but surfaced as a note rather than silently dropped,
   * since "IMS also has this number elsewhere" can be a useful flag. */
  elsewhere: ImsMatch[];
}

/** Looks up a container number against IMS's own "Container Finder" tab.
 * Returns every match at our yard, not just the first — IMS's own data has
 * real, observed cases of the same container number appearing on two
 * different rows for two genuinely different physical units (e.g.
 * "CRIU4025750": one row Dry, the other Reefer) — the caller is expected to
 * show Type/Size so an admin can pick the right one, rather than silently
 * guessing. */
export async function findContainerMatches(containerId: string): Promise<ImsLookupResult> {
  const target = normalize(containerId);
  if (!target) return { matches: [], elsewhere: [] };
  const rows = await loadRows();
  const hits = rows.filter((r) => r.normalizedId === target).map(({ normalizedId: _normalizedId, ...match }) => match);
  return {
    matches: hits.filter((m) => m.depot.trim().toUpperCase() === OUR_DEPOT),
    elsewhere: hits.filter((m) => m.depot.trim().toUpperCase() !== OUR_DEPOT),
  };
}
