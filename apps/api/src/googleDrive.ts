import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { googleServiceAccountKey } from './googleAuth.js';

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
  const key = googleServiceAccountKey();
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

/** Which of the three physical moments a file's evidence of — direct
 * request: Gate In, Gate Out, and Survey (the "Mark ready to move"
 * completion photo) must land in separate Drive folders, not one shared
 * pile, so it's obvious at a glance in Drive itself which stage a photo
 * belongs to — not just in-app. `other` covers everything outside those
 * three (Hydra's movement files today). */
export type UploadCategory = 'gate-in' | 'gate-out' | 'survey' | 'other';

const CATEGORY_FOLDER_NAMES: Record<UploadCategory, string> = {
  'gate-in': 'Gate In Photos',
  'gate-out': 'Gate Out Photos',
  survey: 'Survey Photos',
  other: 'Other Uploads',
};

/** Folder ids resolved once per warm process, same reasoning as the client
 * singleton above — a cold start re-resolves (cheap, a single list call,
 * falling back to a single create the very first time a category is ever
 * used), a warm one never looks it up twice. */
const folderIdCache = new Map<UploadCategory, string>();

/** Finds this category's folder directly under the Shared Drive root,
 * creating it the first time a category is ever uploaded to. Scoped to the
 * Shared Drive itself (`corpora: 'drive'`) rather than a plain search, so
 * this can never match a same-named folder somewhere else the service
 * account happens to have access to. */
async function resolveCategoryFolder(category: UploadCategory): Promise<string> {
  const cached = folderIdCache.get(category);
  if (cached) return cached;

  const name = CATEGORY_FOLDER_NAMES[category];
  const found = await drive().files.list({
    q: `'${SHARED_DRIVE_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`,
    driveId: SHARED_DRIVE_ID,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id)',
  });
  let folderId = found.data.files?.[0]?.id;

  if (!folderId) {
    const created = await drive().files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [SHARED_DRIVE_ID] },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = created.data.id ?? undefined;
    if (!folderId) throw new Error('Could not create this upload category’s Drive folder.');
  }

  folderIdCache.set(category, folderId);
  return folderId;
}

/** Uploads one file into the PMS Shared Drive, inside the folder matching
 * its category, and returns its real link. `supportsAllDrives: true` on the
 * create call is required for Shared Drives specifically — omitting it is
 * the most common cause of a confusing "File not found"-style failure
 * against a Shared Drive. */
export async function uploadToDrive(buffer: Buffer, filename: string, mimeType: string, category: UploadCategory): Promise<UploadedFile> {
  const parent = await resolveCategoryFolder(category);
  const res = await drive().files.create({
    requestBody: { name: filename, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  if (!res.data.id || !res.data.webViewLink) throw new Error('Drive upload did not return a file id/link.');
  return { id: res.data.id, url: res.data.webViewLink };
}
