import type { SessionUser } from './api';

export interface DevAccount {
  role: SessionUser['role'];
  label: string;
  email: string;
  password: string;
}

/**
 * The one-click dev shortcut (Login.tsx, AppShell's account switcher) —
 * `import.meta.env.DEV`-gated, so it never ships in a production build. The
 * product moved to a single Admin account (SPEC.md), so this is the only
 * account a shortcut offers; everything else signs in by typing real
 * credentials. This used to also list three seeded dev/test fixture
 * accounts (supervisor/technician/viewer, sharing one placeholder password)
 * — removed by direct request along with the seed script that created them
 * (apps/api/scripts/seedUsers.ts), once they weren't wanted sitting in
 * Access Management as fake logins anymore.
 */
export const ADMIN_ACCOUNT: DevAccount = { role: 'manager', label: 'Admin', email: 'admin@crystalpms.com', password: 'admin123' };
