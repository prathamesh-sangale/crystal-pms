import { env } from './env.js';

/**
 * Client for the "PMS Gate Bridge" Apps Script (tools/legacy-bridge/
 * PmsGateBridge.gs), which runs as the owner of GATE_IN_OUT_DOCS. Google
 * won't let PMS's service account create files in that personal My Drive
 * folder, so the bridge does the three things that need the owner:
 *  - `copy`: copies PMS's uploaded files into GATE_IN_OUT_DOCS with the legacy
 *    names (CXRU1040451_Left_Side, …) and returns their links;
 *  - `pdfEmail`: builds the inspection PDF there, writes its link into the
 *    ledger row PMS appended, and sends the legacy email. It checks that the
 *    ledger row has no PDF yet before doing anything, so a retry never
 *    emails twice.
 */

export function bridgeConfigured(): boolean {
  return Boolean(env.LEGACY_BRIDGE_URL && env.LEGACY_BRIDGE_SECRET);
}

async function call<T>(action: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const res = await fetch(env.LEGACY_BRIDGE_URL ?? '', {
    method: 'POST',
    // text/plain: Apps Script reads the raw body from e.postData.contents.
    headers: { 'content-type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ secret: env.LEGACY_BRIDGE_SECRET, action, ...payload }),
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: { ok?: boolean; error?: string } & T;
  try {
    body = JSON.parse(text) as { ok?: boolean; error?: string } & T;
  } catch {
    throw new Error(`Bridge did not answer with JSON (HTTP ${res.status}). Check its deployment access.`);
  }
  if (!body.ok) throw new Error(`Bridge ${action} failed: ${body.error ?? 'unknown error'}`);
  return body;
}

/** The Drive file id inside a Drive link (…/file/d/<id>/… or …?id=<id>), or null. */
export function driveFileId(link: string): string | null {
  const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(link) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(link);
  return m ? m[1]! : null;
}

export interface BridgeFile {
  key: string;
  fileId: string;
  name: string;
}

export async function bridgeCopy(containerNo: string, files: BridgeFile[]): Promise<Record<string, string>> {
  const body = await call<{ links: Record<string, string> }>('copy', { containerNo, files }, 9000);
  return body.links ?? {};
}

export interface PdfEmailInput {
  containerNo: string;
  kind: 'in' | 'out';
  ledgerSheetId: string;
  ledgerTab: string;
  ledgerRow: number;
  photoFileIds: string[];
  summary: Record<string, string>;
}

/**
 * The PDF and email can take longer than PMS's request limit. The bridge
 * keeps running after PMS stops waiting, so a timeout here counts as sent;
 * the bridge's own ledger-row check prevents any double email on retry.
 */
export async function bridgePdfEmail(input: PdfEmailInput): Promise<string> {
  try {
    const body = await call<{ pdfUrl?: string; skipped?: string }>('pdfEmail', { ...input }, 8000);
    return body.skipped ? `Already done earlier (${body.skipped}).` : `PDF and email done${body.pdfUrl ? `: ${body.pdfUrl}` : ''}.`;
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return 'Sent to the bridge; still building the PDF and email when PMS stopped waiting.';
    }
    throw err;
  }
}
