/**
 * One-time seed: pushes the real admin login into Supabase's `users` table —
 * the landing spot the v2 schema's own migration comment already earmarked
 * for this swap ("swapping to Supabase Auth later replaces this table's
 * role, not this migration's other tables"). Replaces the old v1 Prisma
 * `User` table as the thing `/api/auth/login` actually checks.
 *
 * The three dev/test fixture accounts this used to also seed (supervisor,
 * technician, viewer — all sharing one placeholder password) were removed
 * by direct request once real usage started: they weren't real people, and
 * re-running this script was quietly recreating them any time it ran. Real
 * logins belong in Access Management now, not in this file.
 *
 * Run manually: npm run seed-users (in apps/api). Safe to re-run: upserts on
 * id, never duplicates.
 */
import { hashPassword } from '../src/auth.js';
import { supabase } from '../src/supabase.js';

const ADMIN_PASSWORD = 'admin123';

const USERS = [{ id: 'u-sitaram', email: 'admin@crystalpms.com', name: 'Sitaram', role: 'manager', password: ADMIN_PASSWORD }];

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
  for (const u of USERS) console.log(`Sign in: ${u.email}  ${u.password}`);
}

main();
