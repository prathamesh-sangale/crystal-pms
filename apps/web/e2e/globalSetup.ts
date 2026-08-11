import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Re-seed the development database before the suite runs.
 *
 * These tests register and remove containers, tick checklist items and write
 * notes. Without a known starting point a failed run leaves debris that makes
 * the next run fail for a different reason — and the screenshots stop being
 * comparable. The seed is fixed, so this restores exactly the board every
 * assertion was written against.
 */
export default function globalSetup(): void {
  execSync('npm run db:seed -w @pms/api', { cwd: REPO, stdio: 'pipe' });
}
