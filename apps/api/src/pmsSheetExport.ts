import { google, type sheets_v4 } from 'googleapis';
import { googleServiceAccountKey } from './googleAuth.js';
import { supabase } from './supabase.js';
import { fromContainerRow, type ContainerRow } from './v2Mappers.js';

/**
 * The client's own "PMS" Google Sheet — a reporting export, entirely
 * separate from IMS's spreadsheet (imsLookup.ts, read-only, different
 * credential scope) and from the depot's original Gate-In/Out sheet
 * (never touched by this app at all). This one is new, client-provided,
 * and explicitly meant to be written to.
 */
const PMS_SHEET_ID = '1w0rNwqJ8fGKJdVoNtPsm1lFTCd4T-u7IWyXvOnchi0w';

// Column order for the per-section progress cells -- must line up with the
// "Painting, PTI, Cleaning, Repairment, Sailing Crew" headers below.
const SECTION_ORDER = ['painting', 'pti', 'cleaning', 'all_rounder', 'sailing'];

let client: sheets_v4.Sheets | null = null;

/** Write-scoped, unlike imsLookup.ts's read-only client -- this is the one
 * place in the app that's actually allowed to write to an external sheet. */
function sheets(): sheets_v4.Sheets {
  if (client) return client;
  const key = googleServiceAccountKey();
  const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

interface TabSpec {
  title: string;
  headers: string[];
  rows: unknown[][];
}

/** Creates any tabs that don't exist yet (skipped if already present --
 * "Containers" already exists, from an earlier, now-removed feature), then
 * fully refreshes every tab's data: clears whatever's below the header row
 * and writes the current full set. Not incremental -- simplest thing that's
 * always correct, and it's an on-demand export, not a live sync. */
async function writeTabs(specs: TabSpec[]): Promise<void> {
  const meta = await sheets().spreadsheets.get({ spreadsheetId: PMS_SHEET_ID });
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));

  const toCreate = specs.filter((s) => !existing.has(s.title));
  if (toCreate.length > 0) {
    await sheets().spreadsheets.batchUpdate({
      spreadsheetId: PMS_SHEET_ID,
      requestBody: { requests: toCreate.map((s) => ({ addSheet: { properties: { title: s.title } } })) },
    });
  }

  for (const spec of specs) {
    await sheets().spreadsheets.values.clear({ spreadsheetId: PMS_SHEET_ID, range: `${spec.title}!A1:ZZ` });
    await sheets().spreadsheets.values.update({
      spreadsheetId: PMS_SHEET_ID,
      range: `${spec.title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [spec.headers, ...spec.rows] },
    });
  }
}

interface ExportContainer {
  id: string;
  typeCode: string;
  size: string;
  color: string | null;
  priority: boolean;
  currentSite: string | null;
  readyAt: string | null;
  departedAt: string | null;
  registeredAt: string;
  sections: Array<{ kind: string; tasks: Array<{ state: string }> }>;
}

function containerSheetRow(c: ExportContainer): unknown[] {
  const sectionProgress = (kind: string): string => {
    const section = c.sections.find((s) => s.kind === kind);
    if (!section || section.tasks.length === 0) return '';
    const done = section.tasks.filter((t) => t.state === 'done' || t.state === 'na').length;
    return done === section.tasks.length ? 'Done' : `${done}/${section.tasks.length}`;
  };
  const openTasks = c.sections.reduce((sum, s) => sum + s.tasks.filter((t) => t.state !== 'done' && t.state !== 'na').length, 0);
  const status = c.departedAt ? 'Departed' : c.readyAt ? 'Ready to move' : openTasks > 0 ? 'In progress' : 'Open';

  return [
    c.id,
    c.typeCode,
    c.size,
    c.color ?? '',
    c.priority ? 'Yes' : 'No',
    c.currentSite ?? '',
    status,
    c.readyAt ?? '',
    ...SECTION_ORDER.map(sectionProgress),
    openTasks,
    c.registeredAt,
    c.departedAt ?? '',
  ];
}

interface GateEntry {
  kind: 'in' | 'out';
  loggedAt: string;
  loggedBy: string;
  movementDate: string;
  indentRef: string;
  customerName: string;
  location: string;
  transporterName: string;
  transporterNumber: string;
  vehicleNumber: string;
  ptiCheck: string;
}

function gateLogRows(containerId: string, gateIn: unknown, gateOut: unknown): unknown[][] {
  const rows: unknown[][] = [];
  for (const entry of [gateIn, gateOut]) {
    if (!entry) continue;
    const g = entry as GateEntry;
    rows.push([
      containerId,
      g.kind === 'in' ? 'In' : 'Out',
      g.loggedAt ?? '',
      g.loggedBy ?? '',
      g.movementDate ?? '',
      g.indentRef ?? '',
      g.customerName ?? '',
      g.location ?? '',
      g.transporterName ?? '',
      g.transporterNumber ?? '',
      g.vehicleNumber ?? '',
      g.ptiCheck ?? '',
    ]);
  }
  return rows;
}

interface WorkerRow {
  id: string;
  name: string;
  type: string;
  active: boolean;
}

const WORKER_TYPE_LABELS: Record<string, string> = {
  painter: 'Painter',
  painter_helper: 'Painter Helper',
  technician: 'Technician',
  all_rounder: 'All-Rounder',
  cleaner: 'Cleaner',
  tea_boy: 'Tea Boy',
  sailing_crew: 'Sailing Crew',
};

export async function exportToSheet(): Promise<{ tabs: string[]; exportedAt: string }> {
  const [containersRes, workersRes, hydraRes] = await Promise.all([
    supabase().from('containers').select('*, sections(*, tasks(*))'),
    supabase().from('workers').select('*'),
    supabase().from('hydra_movements').select('*').order('movement_date', { ascending: false }),
  ]);
  if (containersRes.error) throw containersRes.error;
  if (workersRes.error) throw workersRes.error;
  if (hydraRes.error) throw hydraRes.error;

  const containers = (containersRes.data as ContainerRow[]).map((row) => fromContainerRow(row) as unknown as ExportContainer);
  const workers = workersRes.data as WorkerRow[];
  const hydraMovements = hydraRes.data as Array<Record<string, unknown>>;

  // Per-worker open/running task counts and total hours -- same aggregation
  // WorkerDetailDrawer.tsx does client-side, done here from the same
  // already-fetched container/task data instead of a second query per worker.
  const workerStats = new Map<string, { open: number; running: number; hours: number }>();
  for (const c of containers) {
    for (const s of c.sections) {
      for (const t of s.tasks as Array<{ state: string; workerId?: string | null; elapsedSec?: number }>) {
        if (!t.workerId) continue;
        const stat = workerStats.get(t.workerId) ?? { open: 0, running: 0, hours: 0 };
        if (t.state === 'pending' || t.state === 'running') stat.open += 1;
        if (t.state === 'running') stat.running += 1;
        if (t.state === 'done') stat.hours += (t.elapsedSec ?? 0) / 3600;
        workerStats.set(t.workerId, stat);
      }
    }
  }

  const specs: TabSpec[] = [
    {
      title: 'Containers',
      headers: [
        'Container ID', 'Type', 'Size', 'Color', 'Fast-track', 'Current Site', 'Status', 'Ready to Move',
        'Painting', 'PTI', 'Cleaning', 'Repairment', 'Sailing Crew', 'Open Tasks', 'Registered At', 'Gated Out At',
      ],
      rows: containers.map(containerSheetRow),
    },
    {
      title: 'Gate Log',
      headers: [
        'Container ID', 'Kind', 'Logged At', 'Logged By', 'Movement Date', 'Indent Ref',
        'Customer Name', 'Location', 'Transporter Name', 'Transporter Number', 'Vehicle Number', 'PTI Check',
      ],
      rows: containers.flatMap((c) => gateLogRows(c.id, (c as unknown as { gateIn: unknown }).gateIn, (c as unknown as { gateOut: unknown }).gateOut)),
    },
    {
      title: 'Workers',
      headers: ['Name', 'Role', 'Active', 'Open Tasks', 'Running Now', 'Hours (All time)'],
      rows: workers.map((w) => {
        const stat = workerStats.get(w.id) ?? { open: 0, running: 0, hours: 0 };
        return [w.name, WORKER_TYPE_LABELS[w.type] ?? w.type, w.active ? 'Yes' : 'No', stat.open, stat.running, Math.round(stat.hours * 10) / 10];
      }),
    },
    {
      title: 'Hydra Movements',
      headers: ['Date', 'Container No', 'Type', 'Size', 'Movement Type', 'Direction', 'Logged By', 'File Link'],
      rows: hydraMovements.map((m) => [
        m.movement_date, m.container_no, m.type, m.size, m.movement_type, m.direction ?? '', m.logged_by ?? '', m.file_url ?? '',
      ]),
    },
  ];

  await writeTabs(specs);
  return { tabs: specs.map((s) => s.title), exportedAt: new Date().toISOString() };
}
