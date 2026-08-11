import type { IconName } from '../components/crystal/Icon';
import type { Overview } from './api';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Page title and one-line description, shown in the page header. */
  title: string;
  description: string;
  /**
   * A count only appears when it represents something waiting for the user.
   * Returning null means no badge at all — not a zero.
   */
  tally?: (overview: Overview) => number | null;
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
    heading: 'Depot',
    items: [
      {
        to: '/depot',
        label: 'Depot Command',
        icon: 'warehouse',
        title: 'Depot Command',
        description:
          'Home-depot readiness, network condition, off-lease arrivals and order cover — one view.',
      },
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: 'home',
        title: 'Dashboard',
        description: 'Fleet readiness at a glance, and where every container currently sits.',
      },
    ],
  },
  {
    heading: 'Readiness',
    items: [
      {
        to: '/tomorrow',
        label: "Tomorrow's Work",
        icon: 'calendar',
        title: "Tomorrow's Work",
        description: 'The tasks required next, who owns each one, and who covers if they are out.',
        tally: (o) => o.totals.active || null,
      },
      {
        to: '/pipeline',
        label: 'Readiness Pipeline',
        icon: 'container',
        title: 'Readiness Pipeline',
        description: 'Every container across the ten readiness stages, gate-in to release.',
      },
      {
        to: '/timeline',
        label: 'Stage Timeline',
        icon: 'chart',
        title: 'Stage Timeline',
        description: 'Planned duration per stage, and how many containers each one is holding.',
      },
    ],
  },
  {
    heading: 'Records',
    items: [
      {
        to: '/fleet',
        label: 'All Containers',
        icon: 'list',
        title: 'All Containers',
        description: 'The full register, searchable by unit number, customer, technician or depot.',
      },
      {
        to: '/checklist',
        label: 'Checklist Library',
        icon: 'doc',
        title: 'Checklist Library',
        description: 'The standard task template for every stage, and what each variant adds.',
      },
    ],
  },
  {
    heading: 'Attention',
    items: [
      {
        to: '/delayed',
        label: 'Delayed / At Risk',
        icon: 'alert',
        title: 'Delayed / At Risk',
        description: 'Containers past the day budget for the stage they are in.',
        tally: (o) => o.totals.late || null,
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.to === pathname);
}
