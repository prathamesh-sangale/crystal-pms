import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cached: ServiceAccountKey | null = null;

/**
 * The same service account backs Drive uploads and the IMS Sheets lookup.
 * Locally, it's read from the gitignored credentials file, same as always.
 * In a serverless deployment (Vercel, etc.) there's no local filesystem to
 * read a gitignored file from — `GOOGLE_SERVICE_ACCOUNT_JSON` (the key
 * file's full contents, set as a Vercel project environment variable) is
 * checked first and takes priority when present, so this works in both
 * places without the caller needing to know which one it's running in.
 */
export function googleServiceAccountKey(): ServiceAccountKey {
  if (cached) return cached;

  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    cached = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccountKey;
    return cached;
  }

  const keyPath = path.join(__dirname, '..', 'credentials', 'google-service-account.json');
  cached = JSON.parse(readFileSync(keyPath, 'utf8')) as ServiceAccountKey;
  return cached;
}
