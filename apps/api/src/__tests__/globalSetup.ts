import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Sync the schema onto the test database, then seed it with the same fixed
 * fixture the dev database uses. Every test therefore starts from the exact
 * board the screenshots are taken against.
 *
 * `db push` here is deliberately *not* `--force-reset`: the seed clears every
 * table itself, so a plain sync gives the same clean slate without handing a
 * destructive flag to an automated run. A push that cannot proceed without
 * dropping data should fail loudly rather than quietly wipe a database.
 */
export default function setup(): void {
  const env = { ...process.env, DATABASE_URL: 'file:./test.db' };
  // `npx.cmd` directly rather than `shell: true`, so arguments stay escaped.
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const run = (args: string[]): void => {
    execFileSync(npx, args, { cwd: API_DIR, env, stdio: 'pipe' });
  };

  run(['prisma', 'db', 'push', '--skip-generate']);
  run(['tsx', 'prisma/seed.ts']);
}
