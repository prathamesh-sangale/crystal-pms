import { env } from './env.js';
import { bridgeConfigured, bridgeCopy, bridgePdfEmail, driveFileId, type BridgeFile } from './legacyBridge.js';
import {
  buildLedgerRow,
  istDmy,
  LEGACY_FILE_SUFFIX,
  normalizeNo,
  PHOTO_KEYS,
  planImport,
  type LedgerEntryRow,
  type LedgerLinks,
  type PhotoKey,
} from './legacyRows.js';
import { appendLedgerRow, autoCloseIfComplete, LEDGER_TAB, legacyIds, markRepository, readLedgerTail, writeImsStock } from './legacySheets.js';
import { supabase } from './supabase.js';

/**
 * PMS <-> legacy Gate-In portal sync, run in short resumable steps so each
 * request stays inside the hosting time limit. The state of every step is
 * saved on the gate entry itself (`legacySync`), so a step that succeeded is
 * never repeated and an interrupted sync resumes later (catch-up).
 *
 * Off unless LEGACY_SYNC_ENABLED=true, and only for PMS gate-form entries
 * logged at or after LEGACY_SYNC_SINCE: nothing made before switch-on is
 * ever written to the shared sheets.
 */

export type StepName = 'copy' | 'ledger' | 'ims' | 'repo' | 'autoclose' | 'pdfEmail';
export interface StepResult {
  status: 'ok' | 'skipped' | 'failed';
  detail: string;
  at: string;
  attempts: number;
}
export interface LegacySyncState {
  steps: Partial<Record<StepName, StepResult>>;
  links?: LedgerLinks;
  copyIds?: string[];
  ledgerRow?: number;
  repo?: { indentId?: string; justMarked: boolean; indentRows?: unknown[] };
  done: boolean;
}

const MAX_ATTEMPTS = 3;
/** Marker in the ledger's Photo_Merge_Pdf cell: "copy photos, build the PDF, send the email". */
export const PMS_PDF_PENDING = 'PMS-PENDING';
const on = (v: string | undefined): boolean => v === 'true';

export function legacySyncEnabled(): boolean {
  return on(env.LEGACY_SYNC_ENABLED) && Boolean(env.LEGACY_SYNC_SINCE && !Number.isNaN(Date.parse(env.LEGACY_SYNC_SINCE)));
}
export function legacyImportEnabled(): boolean {
  return on(env.LEGACY_IMPORT) && Boolean(env.LEGACY_IMPORT_SINCE && !Number.isNaN(Date.parse(env.LEGACY_IMPORT_SINCE)));
}
export function legacySwitches(): Record<string, boolean> {
  return {
    sync: legacySyncEnabled(),
    imsWrite: legacySyncEnabled() && on(env.LEGACY_IMS_WRITE),
    autoClose: legacySyncEnabled() && on(env.LEGACY_AUTOCLOSE),
    bridge: legacySyncEnabled() && bridgeConfigured(),
    import: legacyImportEnabled(),
  };
}

type Entry = Record<string, unknown> & { kind: 'in' | 'out'; loggedAt: string; source?: string; legacySync?: LegacySyncState };
interface ContainerRow {
  id: string;
  type_code: string;
  size: string;
  gate_in: Entry | null;
  gate_out: Entry | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function pmsLinks(entry: Entry): LedgerLinks {
  const photos = (entry.photos ?? {}) as Record<string, unknown>;
  const out: Partial<Record<PhotoKey, string>> = {};
  for (const k of PHOTO_KEYS) if (str(photos[k])) out[k] = str(photos[k]);
  const additional = Array.isArray(photos.additional) ? (photos.additional as unknown[]).map(str).filter(Boolean) : [];
  return { photos: out, additional, lrCopy: str(entry.lrCopyUrl), ptiVideo: str(entry.ptiVideoUrl), pdf: '' };
}

function eligible(entry: Entry | null): entry is Entry {
  if (!entry || entry.source !== 'gate-form') return false;
  const since = Date.parse(env.LEGACY_SYNC_SINCE ?? '');
  return Date.parse(entry.loggedAt) >= since;
}

async function saveState(containerId: string, kind: 'in' | 'out', entry: Entry, state: LegacySyncState): Promise<void> {
  const column = kind === 'in' ? 'gate_in' : 'gate_out';
  const { error } = await supabase().from('containers').update({ [column]: { ...entry, legacySync: state } }).eq('id', containerId);
  if (error) throw new Error(error.message);
}

function stepsFor(kind: 'in' | 'out'): StepName[] {
  return kind === 'in' ? ['copy', 'ledger', 'ims', 'repo', 'autoclose', 'pdfEmail'] : ['copy', 'ledger', 'repo', 'pdfEmail'];
}

const settled = (r?: StepResult): boolean => !!r && (r.status === 'ok' || r.status === 'skipped' || r.attempts >= MAX_ATTEMPTS);

async function runStep(step: StepName, c: ContainerRow, kind: 'in' | 'out', entry: Entry, state: LegacySyncState, actorEmail: string): Promise<{ status: 'ok' | 'skipped'; detail: string }> {
  switch (step) {
    case 'copy': {
      if (!bridgeConfigured()) return { status: 'skipped', detail: 'Photos are copied later by the Gate-In script timer.' };
      const links = pmsLinks(entry);
      const files: BridgeFile[] = [];
      for (const k of PHOTO_KEYS) {
        const id = links.photos[k] ? driveFileId(links.photos[k]!) : null;
        if (id) files.push({ key: k, fileId: id, name: `${c.id}_${LEGACY_FILE_SUFFIX[k]}` });
      }
      const lr = links.lrCopy ? driveFileId(links.lrCopy) : null;
      if (lr) files.push({ key: 'lrCopy', fileId: lr, name: `${c.id}_LR_Copy` });
      links.additional.forEach((l, i) => {
        const id = driveFileId(l);
        if (id) files.push({ key: `additional${i}`, fileId: id, name: `${c.id}_Additional_${i + 1}` });
      });
      if (files.length === 0) return { status: 'skipped', detail: 'No files to copy.' };
      const copied = await bridgeCopy(c.id, files);
      const merged: LedgerLinks = { ...links, photos: { ...links.photos } };
      for (const k of PHOTO_KEYS) if (copied[k]) merged.photos[k] = copied[k];
      if (copied.lrCopy) merged.lrCopy = copied.lrCopy;
      merged.additional = links.additional.map((l, i) => copied[`additional${i}`] ?? l);
      state.links = merged;
      state.copyIds = Object.values(copied).map((l) => driveFileId(l)).filter((x): x is string => Boolean(x));
      return { status: 'ok', detail: `${Object.keys(copied).length} file(s) copied into GATE_IN_OUT_DOCS.` };
    }
    case 'ledger': {
      // Without a callable bridge (the company Workspace blocks "Anyone" web
      // apps), the PDF cell gets PMS_PDF_PENDING: a time trigger in the
      // Gate-In script, running as the folder owner, picks such rows up,
      // copies the photos into GATE_IN_OUT_DOCS, builds the PDF and sends
      // the email (tools/legacy-bridge/GateIn_Code_with_PMS_bridge.gs).
      const links = state.links ?? { ...pmsLinks(entry), pdf: bridgeConfigured() ? '' : PMS_PDF_PENDING };
      const row = buildLedgerRow({ id: c.id, typeCode: c.type_code, size: c.size }, entry as never, links, actorEmail);
      state.ledgerRow = await appendLedgerRow(row, c.id);
      return { status: 'ok', detail: `Gate ledger row ${state.ledgerRow}.` };
    }
    case 'ims': {
      if (!on(env.LEGACY_IMS_WRITE)) return { status: 'skipped', detail: 'IMS writing is switched off.' };
      return writeImsStock(c.id, c.type_code, istDmy(entry.loggedAt));
    }
    case 'repo': {
      const r = await markRepository(c.id, kind, str(entry.indentRef));
      state.repo = { indentId: r.indentId, justMarked: r.justMarked, indentRows: r.indentRows };
      return { status: r.status, detail: r.detail };
    }
    case 'autoclose': {
      if (!on(env.LEGACY_AUTOCLOSE)) return { status: 'skipped', detail: 'Auto-close is switched off.' };
      if (!state.repo?.justMarked || !state.repo.indentId) return { status: 'skipped', detail: 'No newly marked indent row.' };
      return autoCloseIfComplete(state.repo.indentId, (state.repo.indentRows ?? []) as never, true);
    }
    case 'pdfEmail': {
      if (!bridgeConfigured()) return { status: 'skipped', detail: 'Handed to the Gate-In script timer (ledger PDF cell marked PMS-PENDING).' };
      if (!state.ledgerRow) return { status: 'skipped', detail: 'No ledger row to attach the PDF to.' };
      const detail = await bridgePdfEmail({
        containerNo: c.id,
        kind,
        ledgerSheetId: legacyIds().ledger,
        ledgerTab: LEDGER_TAB,
        ledgerRow: state.ledgerRow,
        photoFileIds: state.copyIds ?? [],
        summary: {
          status: kind === 'in' ? 'Inward (Gate-In)' : 'Outward (Gate-Out)',
          date: str(entry.movementDate),
          indent: str(entry.indentRef),
          order: [str(entry.orderNumber), str(entry.orderType)].filter(Boolean).join(' / '),
          type: c.type_code,
          size: c.size,
          customer: str(entry.customerName),
          location: str(entry.location),
          transporter: [str(entry.transporterName), str(entry.transporterNumber)].filter(Boolean).join(' / '),
          vehicle: str(entry.vehicleNumber),
          remarks: str(entry.remarks),
          by: str(entry.loggedBy) || actorEmail,
        },
      });
      return { status: 'ok', detail };
    }
  }
}

/**
 * Runs the pending steps of one gate entry's sync within `budgetMs`.
 * Returns null when the entry isn't eligible (switch off, not a PMS form
 * entry, or logged before switch-on).
 */
export async function runLegacySync(containerId: string, kind: 'in' | 'out', actorEmail: string, budgetMs = 7000): Promise<LegacySyncState | null> {
  if (!legacySyncEnabled()) return null;
  const started = Date.now();
  const { data, error } = await supabase().from('containers').select('id, type_code, size, gate_in, gate_out').eq('id', containerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const c = data as ContainerRow;
  const entry = kind === 'in' ? c.gate_in : c.gate_out;
  if (!eligible(entry)) return null;

  const state: LegacySyncState = entry.legacySync ?? { steps: {}, done: false };
  for (const step of stepsFor(kind)) {
    const prev = state.steps[step];
    if (settled(prev)) continue;
    if (Date.now() - started > budgetMs) break;
    const attempts = (prev?.attempts ?? 0) + 1;
    try {
      const r = await runStep(step, c, kind, entry, state, actorEmail);
      state.steps[step] = { ...r, at: new Date().toISOString(), attempts };
    } catch (err) {
      state.steps[step] = { status: 'failed', detail: err instanceof Error ? err.message : String(err), at: new Date().toISOString(), attempts };
      // The ledger row carries the links the later steps need: stop here and retry later.
      if (step === 'ledger' || step === 'copy') {
        state.done = false;
        await saveState(c.id, kind, entry, state);
        return state;
      }
    }
    await saveState(c.id, kind, entry, state);
  }
  state.done = stepsFor(kind).every((s) => settled(state.steps[s]));
  await saveState(c.id, kind, entry, state);
  return state;
}

/** Resumes unfinished syncs from the last 3 days, within the time budget. */
export async function resumePendingSyncs(actorEmail: string, budgetMs: number): Promise<number> {
  if (!legacySyncEnabled()) return 0;
  const started = Date.now();
  const { data, error } = await supabase().from('containers').select('id, gate_in, gate_out');
  if (error) throw new Error(error.message);
  const cutoff = Date.now() - 3 * 86_400_000;
  let resumed = 0;
  for (const row of (data ?? []) as Array<{ id: string; gate_in: Entry | null; gate_out: Entry | null }>) {
    for (const kind of ['in', 'out'] as const) {
      const entry = kind === 'in' ? row.gate_in : row.gate_out;
      if (!eligible(entry) || Date.parse(entry.loggedAt) < cutoff || entry.legacySync?.done) continue;
      const left = budgetMs - (Date.now() - started);
      if (left < 2500) return resumed;
      await runLegacySync(row.id, kind, actorEmail, left);
      resumed++;
    }
  }
  return resumed;
}

// ------------------------------------------------ old portal -> PMS import

const TYPE_MAP: Record<string, string> = { DRY: 'Dry', REEFER: 'Reefer', 'ISO TANK': 'ISO Tank', 'PORTA CABIN': 'Porta Cabin' };

function importedEntry(r: LedgerEntryRow, kind: 'in' | 'out'): Record<string, unknown> {
  const loggedAt = new Date(r.timestampMs ?? Date.now()).toISOString();
  return {
    kind,
    loggedAt,
    loggedBy: r.email,
    movementDate: r.date || loggedAt.slice(0, 10),
    indentRef: '',
    orderNumber: '',
    customerName: r.customer,
    location: r.location,
    transporterName: r.transporterName,
    transporterNumber: r.transporterNo,
    vehicleNumber: r.vehicleNo,
    lrCopyName: r.lrCopy ? 'LR Copy (old portal)' : null,
    lrCopyUrl: r.lrCopy || null,
    ptiCheck: r.ptiCheck === 'Yes' ? 'Yes' : 'No',
    ptiVideoName: null,
    ptiVideoUrl: r.ptiVideo || null,
    photos: { ...Object.fromEntries(PHOTO_KEYS.map((k) => [k, r.photos[k] ?? ''])), additional: r.additional },
    paintingRequired: null,
    repairRequired: r.repairRequired === 'Yes' ? true : r.repairRequired === 'No' ? false : null,
    repairFields: [],
    machineIssueFound: null,
    machineRepairNote: '',
    cleaningRequired: null,
    estBudget: r.budget,
    remarks: [r.remarks, `From the old Gate-In portal (ledger row ${r.rowNumber}).`].filter(Boolean).join(' '),
    source: 'legacy-import',
    legacyLedgerRow: r.rowNumber,
    inspectionPdf: r.pdf || null,
  };
}

export interface ImportSummary {
  created: string[];
  gatedOut: string[];
  skipped: Array<{ row: number; container: string; reason: string }>;
}

/**
 * Mirrors new old-portal ledger rows into PMS (PMS's own database only; the
 * sheets are only read). Rows before LEGACY_IMPORT_SINCE are ignored, so
 * history is never imported. Idempotent by PMS's own state, so PMS's own
 * ledger rows and rows already imported are skipped naturally.
 */
export async function runLegacyImport(): Promise<ImportSummary | null> {
  if (!legacyImportEnabled()) return null;
  const since = Date.parse(env.LEGACY_IMPORT_SINCE ?? '');
  const rows = (await readLedgerTail(300))
    .filter((r) => r.timestampMs !== null && r.timestampMs >= since)
    .sort((a, b) => a.timestampMs! - b.timestampMs! || a.rowNumber - b.rowNumber);
  const summary: ImportSummary = { created: [], gatedOut: [], skipped: [] };
  if (rows.length === 0) return summary;

  const { data, error } = await supabase().from('containers').select('id, departed_at');
  if (error) throw new Error(error.message);
  const active = new Map<string, string>();
  const departed = new Map<string, string>();
  for (const c of (data ?? []) as Array<{ id: string; departed_at: string | null }>) {
    (c.departed_at ? departed : active).set(normalizeNo(c.id), c.id);
  }

  for (const r of rows) {
    const plan = planImport(r, active, departed);
    if (plan.action === 'skip') {
      summary.skipped.push({ row: r.rowNumber, container: r.containerNo, reason: plan.reason });
      continue;
    }
    if (plan.action === 'create') {
      const id = r.containerNo.replace(/\s+/g, '').toUpperCase();
      const entry = importedEntry(r, 'in');
      const { error: insErr } = await supabase().from('containers').insert({
        id,
        type_code: TYPE_MAP[r.type.trim().toUpperCase()] ?? (r.type.trim() || 'Dry'),
        size: r.size || '20 Feet',
        color: null,
        priority: false,
        registered_at: entry.loggedAt,
        current_site: null,
        ready_at: null,
        departed_at: null,
        survey_performed_at: null,
        survey_outcome: null,
        survey_fields: [],
        gate_in: entry,
        gate_out: null,
      });
      if (insErr) {
        summary.skipped.push({ row: r.rowNumber, container: r.containerNo, reason: `Could not add: ${insErr.message}` });
        continue;
      }
      active.set(normalizeNo(id), id);
      summary.created.push(id);
      continue;
    }
    const entry = importedEntry(r, 'out');
    const { error: upErr } = await supabase().from('containers').update({ gate_out: entry, departed_at: entry.loggedAt }).eq('id', plan.containerId).is('departed_at', null);
    if (upErr) {
      summary.skipped.push({ row: r.rowNumber, container: r.containerNo, reason: `Could not gate out: ${upErr.message}` });
      continue;
    }
    active.delete(normalizeNo(plan.containerId));
    departed.set(normalizeNo(plan.containerId), plan.containerId);
    summary.gatedOut.push(plan.containerId);
  }
  return summary;
}
