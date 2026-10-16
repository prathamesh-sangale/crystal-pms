import type { Screen, SessionUser } from './api';
import type { IconName } from '../components/crystal/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Page title and one-line description, shown in the page header. */
  title: string;
  description: string;
  /** Which access-management screen this maps to — absent means always
   * visible to anyone signed in (the System Guide). */
  screen?: Screen;
  /** Admin-only, gated by role rather than `allowedScreens` — granting
   * access is itself the one thing only a manager can ever do. */
  managerOnly?: boolean;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

/**
 * The single source of navigation.
 *
 * The sidebar, the mobile sheet, the command palette and the page headers all
 * read from here, so a screen can never appear in one and be missing from
 * another, and a title can never disagree with itself.
 */
export const NAV: NavGroup[] = [
  {
    heading: 'Workflow',
    items: [
      {
        to: '/live',
        label: 'Live Board',
        icon: 'pulse',
        title: 'Live Board',
        description: 'The same live work, sliced by stage or by crew — what needs doing, and who is doing it right now.',
        screen: 'live',
      },
      {
        to: '/yard',
        label: 'Yard Board',
        icon: 'grid',
        title: 'Yard Board',
        description: 'Survey → gate-in → the sections a container actually needs, running in parallel.',
        screen: 'yard',
      },
      {
        to: '/workers',
        label: 'Worker Roster',
        icon: 'user',
        title: 'Worker Roster',
        description: 'Painters, technicians and the rest of the crew — records Admin manages, not logins.',
        screen: 'workers',
      },
      {
        to: '/dashboards',
        label: 'Dashboards',
        icon: 'gauge',
        title: 'Dashboards',
        description: 'The PTI breakdown and per-section load the workflow is built to surface.',
        screen: 'dashboards',
      },
    ],
  },
  {
    heading: 'Hydra',
    items: [
      {
        to: '/hydra',
        label: 'Hydra',
        icon: 'truck',
        title: 'Hydra',
        description: 'Container and equipment movement log — loading, unloading and shifting, independent of the readiness workflow.',
        screen: 'hydra',
      },
    ],
  },
  {
    heading: 'IMS',
    items: [
      {
        to: '/ims-stock',
        label: 'IMS Stock',
        icon: 'package',
        title: 'IMS Stock',
        description: 'Every container currently available at Crystal Yard in IMS — read-only, never written back to.',
        screen: 'ims-stock',
      },
    ],
  },
  {
    heading: 'Admin',
    items: [
      {
        to: '/access',
        label: 'Access Management',
        icon: 'shield',
        title: 'Access Management',
        description: 'Give a worker a login, and choose exactly which screens they can reach.',
        managerOnly: true,
      },
    ],
  },
  {
    heading: 'Help',
    items: [
      {
        to: '/guide',
        label: 'System Guide',
        icon: 'info',
        title: 'System Guide',
        description: 'How to use Crystal PMS, in plain language — a six-step walkthrough plus answers to every common question.',
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.to === pathname);
}

function itemVisible(item: NavItem, user: Pick<SessionUser, 'role' | 'allowedScreens'> | null): boolean {
  if (item.managerOnly) return user?.role === 'manager';
  if (!item.screen) return true;
  if (!user) return false;
  return user.role === 'manager' || user.allowedScreens.includes(item.screen);
}

/** The one place every nav surface (sidebar, mobile sheet, command palette)
 * filters by what this signed-in user can actually reach — access
 * management's own real gate, mirrored for real server-side by
 * `requireScreen` (apps/api/src/auth.ts) on the routes that matter. */
export function navForUser(user: Pick<SessionUser, 'role' | 'allowedScreens'> | null): NavGroup[] {
  return NAV.map((group) => ({ ...group, items: group.items.filter((item) => itemVisible(item, user)) })).filter(
    (group) => group.items.length > 0
  );
}

export function navItemsForUser(user: Pick<SessionUser, 'role' | 'allowedScreens'> | null): NavItem[] {
  return NAV_ITEMS.filter((item) => itemVisible(item, user));
}
