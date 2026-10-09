/**
 * One-time seed: pushes the 4 dev login accounts (same emails, names, roles,
 * and password this app has always used for local dev) into Supabase's
 * `users` table — the landing spot the v2 schema's own migration comment
 * already earmarked for this swap ("swapping to Supabase Auth later replaces
 * this table's role, not this migration's other tables"). Replaces the old
 * v1 Prisma `User` table as the thing `/api/auth/login` actually checks.
 *
 * Run manually: npm run seed-users (in apps/api). Safe to re-run: upserts on
 * email, never duplicates.
 */
import { hashPassword } from '../src/auth.js';
import { supabase } from '../src/supabase.js';

const DEV_PASSWORD = 'readiness';

const USERS = [
  { id: 'u-sitaram', email: 'sitaram@reeferready.example', name: 'Sitaram Bhat', role: 'manager' },
  { id: 'u-supervisor', email: 'supervisor@reeferready.example', name: 'Priya Nair', role: 'supervisor' },
  { id: 'u-tech', email: 'tech@reeferready.example', name: 'R. Fernandes', role: 'technician' },
  { id: 'u-viewer', email: 'viewer@reeferready.example', name: 'Audit Read-only', role: 'viewer' },
];

async function main() {
  const password_hash = hashPassword(DEV_PASSWORD);
  const rows = USERS.map((u) => ({ ...u, password_hash }));

  const { data, error } = await supabase().from('users').upsert(rows, { onConflict: 'email' }).select();
  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
  console.log(`Seeded ${data?.length ?? 0} user(s).`);
  console.log('Sign in with any of these — password is the same for all:');
  for (const u of USERS) console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(11)} ${DEV_PASSWORD}`);
}

main();
