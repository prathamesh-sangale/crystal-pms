import type { IconName } from '../components/crystal/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Page title and one-line description, shown in the page header. */
  title: string;
  description: string;
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
      },
      {
        to: '/yard',
        label: 'Yard Board',
        icon: 'grid',
        title: 'Yard Board',
        description: 'Survey → gate-in → the sections a container actually needs, running in parallel.',
      },
      {
        to: '/workers',
        label: 'Worker Roster',
        icon: 'user',
        title: 'Worker Roster',
        description: 'Painters, technicians and the rest of the crew — records Admin manages, not logins.',
      },
      {
        to: '/dashboards',
        label: 'Dashboards',
        icon: 'gauge',
        title: 'Dashboards',
        description: 'The PTI breakdown and per-section load the workflow is built to surface.',
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
