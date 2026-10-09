import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { google, type drive_v3 } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The "PMS" Shared Drive, already shared with the service account at
 * Content Manager level (confirmed live — see DEVELOPMENT-STATUS.md). A
 * Shared Drive, not a plain folder, is what makes this work at all: a bare
 * service account has no personal storage quota of its own to own files in,
 * but a Shared Drive has its own storage pool that isn't anyone's personal
 * quota. */
const SHARED_DRIVE_ID = '0ALLbJuWvHFEUUk9PVA';

let client: drive_v3.Drive | null = null;

/** Lazy and memoized, same reasoning as supabase.ts: a server that never
 * actually uploads anything shouldn't need the credential file to exist. */
function drive(): drive_v3.Drive {
  if (client) return client;
  const keyPath = path.join(__dirname, '..', 'credentials', 'google-service-account.json');
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive'] });
  client = google.drive({ version: 'v3', auth });
  return client;
}

export interface UploadedFile {
  id: string;
  /** A real, permanent, clickable Drive link — what gate_in/gate_out's
   * `photos` and `ptiVideoUrl` store from here on, replacing the
   * `URL.createObjectURL()` blob that never survived a page reload. */
  url: string;
}

/** Uploads one file into the PMS Shared Drive and returns its real link.
 * `supportsAllDrives: true` on the create call is required for Shared
 * Drives specifically — omitting it is the most common cause of a
 * confusing "File not found"-style failure against a Shared Drive. */
export async function uploadToDrive(buffer: Buffer, filename: string, mimeType: string): Promise<UploadedFile> {
  const res = await drive().files.create({
    requestBody: { name: filename, parents: [SHARED_DRIVE_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  if (!res.data.id || !res.data.webViewLink) throw new Error('Drive upload did not return a file id/link.');
  return { id: res.data.id, url: res.data.webViewLink };
}
