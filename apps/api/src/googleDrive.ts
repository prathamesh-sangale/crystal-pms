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
 * falling back to a single create the very first time a given folder is
 * ever needed), a warm one never looks it up twice. Keyed by "parentId/name"
 * so a container subfolder under one category never collides with the
 * same-named container under another. */
const folderIdCache = new Map<string, string>();

/** Finds a folder by exact name directly under `parentId`, creating it the
 * first time it's ever needed. Scoped to the Shared Drive itself
 * (`corpora: 'drive'`) rather than a plain search, so this can never match a
 * same-named folder somewhere else the service account happens to have
 * access to.
 *
 * Prefers the *earliest-created* match when more than one same-named folder
 * exists under the same parent — the one real way a lazy find-or-create can
 * misbehave is two concurrent uploads both finding nothing and both
 * creating one (Gate-In alone fires 9 uploads in parallel on first submit
 * for a container; Drive doesn't enforce unique names). That race is rare
 * and can't be fully prevented without a real lock Drive doesn't offer, but
 * always converging on the oldest one means a duplicate — if it ever
 * happens — stops splitting files further the moment the cache populates,
 * rather than staying split indefinitely. */
async function resolveFolder(parentId: string, name: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  const found = await drive().files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`,
    driveId: SHARED_DRIVE_ID,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id, createdTime)',
    orderBy: 'createdTime',
  });
  let folderId = found.data.files?.[0]?.id;

  if (!folderId) {
    const created = await drive().files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = created.data.id ?? undefined;
    if (!folderId) throw new Error(`Could not create the "${name}" Drive folder.`);
  }

  folderIdCache.set(cacheKey, folderId);
  return folderId;
}

/** Drive filenames tolerate far more than this, but a container id is
 * always plain alphanumerics/spaces in practice (SPEC's own container-number
 * format) — stripped defensively anyway so nothing in a folder name can ever
 * be read as a Drive query operator when it's looked up again later. */
function sanitizeFolderName(name: string): string {
  return name.replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 100) || 'Unknown';
}

/** Uploads one file into the PMS Shared Drive, inside the folder matching
 * its category — and, when a container id is given, inside that
 * container's own subfolder within it, so e.g. Gate In Photos/CXRU1032498/
 * holds just that container's own shots rather than every Gate-In photo
 * ever taken sitting in one flat folder together. `containerId` is omitted
 * for uploads with no single container behind them (Hydra's own file).
 * Returns the real link. `supportsAllDrives: true` on the create call is
 * required for Shared Drives specifically — omitting it is the most common
 * cause of a confusing "File not found"-style failure against a Shared
 * Drive. */
export async function uploadToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  category: UploadCategory,
  containerId?: string
): Promise<UploadedFile> {
  let parent = await resolveFolder(SHARED_DRIVE_ID, CATEGORY_FOLDER_NAMES[category]);
  if (containerId) {
    parent = await resolveFolder(parent, sanitizeFolderName(containerId));
  }
  const res = await drive().files.create({
    requestBody: { name: filename, parents: [parent] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  if (!res.data.id || !res.data.webViewLink) throw new Error('Drive upload did not return a file id/link.');
  return { id: res.data.id, url: res.data.webViewLink };
}

/** Confirms a file id actually belongs to the PMS Shared Drive before
 * streaming or deleting it — the one gate standing between "any signed-in
 * user can view/remove their own uploaded photos" and "any signed-in user
 * can view/remove any file this service account can reach," since neither
 * the view nor the delete route take anything else identifying as proof the
 * caller actually uploaded this exact file. Returns its mimeType when it
 * does, null otherwise (not found, or found somewhere this service account
 * can reach but outside our own Shared Drive). */
async function verifyOwnedFile(fileId: string): Promise<string | null> {
  try {
    const res = await drive().files.get({ fileId, fields: 'driveId, mimeType', supportsAllDrives: true });
    if (res.data.driveId !== SHARED_DRIVE_ID) return null;
    return res.data.mimeType ?? 'application/octet-stream';
  } catch {
    return null;
  }
}

/** Streams a previously-uploaded file's actual bytes back out, for display —
 * the thing a bare Drive `webViewLink` can't do inline (it's a sign-in-walled
 * viewer *page*, confirmed live: both of Drive's usual public-embed URL
 * tricks redirect to accounts.google.com for this Shared Drive's files, since
 * they're never shared further than the service account's own Content
 * Manager access). Proxying through this app's own server, behind its own
 * auth, is what actually makes an uploaded photo viewable by anyone using
 * the app, regardless of anyone's personal Google sign-in state. Returns
 * null for a file id that doesn't resolve to something in our own Shared
 * Drive. */
export async function streamFromDrive(fileId: string): Promise<{ mimeType: string; stream: NodeJS.ReadableStream } | null> {
  const mimeType = await verifyOwnedFile(fileId);
  if (!mimeType) return null;
  const res = await drive().files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' });
  return { mimeType, stream: res.data };
}

/** Removes a previously-uploaded file — trashes it, not a hard delete:
 * `files.delete()` was tested directly against this Shared Drive and
 * unreliably 404s even moments after a successful create (a real, observed
 * quirk of this service account/Shared Drive combination, not a guess),
 * while `files.update({ trashed: true })` worked every time. Functionally
 * the same outcome for this app's purposes — gone from the folder, no
 * longer viewable or counted as a live file — just not an instant permanent
 * purge; Drive's own trash auto-empties on its usual schedule. Returns
 * false for a file id that doesn't resolve to something in our own Shared
 * Drive, true once actually trashed. */
export async function removeFromDrive(fileId: string): Promise<boolean> {
  const owned = await verifyOwnedFile(fileId);
  if (!owned) return false;
  await drive().files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true });
  return true;
}
