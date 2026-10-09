import type { SessionUser } from './api';

/**
 * Seeded fixture accounts (apps/api/scripts/seedUsers.ts) — dev/test convenience
 * only. This module is only ever imported behind `import.meta.env.DEV` checks,
 * so it never ships in a production build.
 */
export const DEV_PASSWORD = 'readiness';

export interface DevAccount {
  role: SessionUser['role'];
  label: string;
  email: string;
  password: string;
}

export const DEV_ACCOUNTS: DevAccount[] = [
  { role: 'manager', label: 'Manager', email: 'admin@crystalpms.com', password: 'admin123' },
  { role: 'supervisor', label: 'Supervisor', email: 'supervisor@reeferready.example', password: DEV_PASSWORD },
  { role: 'technician', label: 'Technician', email: 'tech@reeferready.example', password: DEV_PASSWORD },
  { role: 'viewer', label: 'Viewer', email: 'viewer@reeferready.example', password: DEV_PASSWORD },
];

/**
 * The product is moving to a single Admin account (SPEC.md) — the manager
 * role is the closest match today, so it's what the UI now labels "Admin"
 * and the only account the on-screen shortcuts offer. The other three
 * accounts above still work exactly as before; they're just reached by
 * typing credentials (see README.md) rather than a one-click shortcut,
 * since the real routes/permissions haven't changed yet.
 */
export const ADMIN_ACCOUNT: DevAccount = { ...DEV_ACCOUNTS[0]!, label: 'Admin' };
