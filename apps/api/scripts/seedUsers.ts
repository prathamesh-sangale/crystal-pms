/**
 * One-time seed: pushes the 4 dev login accounts into Supabase's `users`
 * table — the landing spot the v2 schema's own migration comment already
 * earmarked for this swap ("swapping to Supabase Auth later replaces this
 * table's role, not this migration's other tables"). Replaces the old v1
 * Prisma `User` table as the thing `/api/auth/login` actually checks.
 *
 * Run manually: npm run seed-users (in apps/api). Safe to re-run: upserts on
 * id, never duplicates.
 */
import { hashPassword } from '../src/auth.js';
import { supabase } from '../src/supabase.js';

const DEV_PASSWORD = 'readiness';
const ADMIN_PASSWORD = 'admin123';

const USERS = [
  { id: 'u-sitaram', email: 'admin@crystalpms.com', name: 'Sitaram Bhat', role: 'manager', password: ADMIN_PASSWORD },
  { id: 'u-supervisor', email: 'supervisor@reeferready.example', name: 'Priya Nair', role: 'supervisor', password: DEV_PASSWORD },
  { id: 'u-tech', email: 'tech@reeferready.example', name: 'R. Fernandes', role: 'technician', password: DEV_PASSWORD },
  { id: 'u-viewer', email: 'viewer@reeferready.example', name: 'Audit Read-only', role: 'viewer', password: DEV_PASSWORD },
];

async function main() {
  // onConflict: 'id', not 'email' — the admin account's email just changed
  // (sitaram@reeferready.example -> admin@crystalpms.com) for the same row
  // (id: 'u-sitaram'); upserting on email would try to INSERT a new row
  // under the old id and collide with the primary key instead of updating it.
  const rows = USERS.map(({ password, ...u }) => ({ ...u, password_hash: hashPassword(password) }));

  const { data, error } = await supabase().from('users').upsert(rows, { onConflict: 'id' }).select();
  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
  console.log(`Seeded ${data?.length ?? 0} user(s).`);
  console.log('Sign in with any of these:');
  for (const u of USERS) console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(11)} ${u.password}`);
}

main();
