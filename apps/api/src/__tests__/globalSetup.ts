import { execSync } from 'node:child_process';
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
 *
 * Commands are fixed strings with no interpolation — `execSync` rather than an
 * argument array because Windows will not spawn `npx.cmd` without a shell.
 */
export default function setup(): void {
  const options = {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'pipe',
  } as const;

  execSync('npx prisma db push --skip-generate', options);
  execSync('npx tsx prisma/seed.ts', options);
}
