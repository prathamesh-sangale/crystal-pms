/**
 * readiness.ts — everything derived from a container's state.
 *
 * Pure functions only. `today` is always passed in rather than read from the
 * clock, so the API, the UI and the tests all agree on what "late" means and
 * a test never depends on the day it runs.
 */
import {
  FINAL_STAGE,
  STAGES,
  STAGE_BY_ID,
  extraDaysForStage,
  stageBudget,
  stageIndex,
  type AnteroomVariant,
  type ContainerSize,
  type ContainerType,
  type Grade,
  type Priority,
  type StageId,
} from './process.js';

/* ------------------------------------------------------------------------ */
/* Shapes                                                                    */
/* ------------------------------------------------------------------------ */

export interface ChecklistItem {
  /** Task template key, e.g. `mechanical.07`. */
  key: string;
  stage: StageId;
  label: string;
  hrs: number;
  onlyFor: ContainerType[] | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
}

export interface Container {
  id: string;
  size: ContainerSize;
  type: ContainerType;
  anteroomVariant: AnteroomVariant | null;
  customer: string;
  priority: Priority;
  assignee: string;
  depot: string;
  stage: StageId;
  /** ISO date, `YYYY-MM-DD`. */
  received: string;
  stageEntered: string;
  notes: string;
  checklist: ChecklistItem[];
}

export interface OffLeaseUnit {
  id: string;
  customer: string;
  size: ContainerSize;
  type: ContainerType;
  expected: string;
  depot: string;
  grade: Grade;
  notes: string;
}

export interface Order {
  id: string;
  customer: string;
  size: ContainerSize;
  type: ContainerType;
  qty: number;
  needBy: string;
  requirement: string;
}

export interface Technician {
  name: string;
  /** Named cover if this technician is unavailable. */
  backup: string;
}

/* ------------------------------------------------------------------------ */
/* Dates                                                                     */
/* ------------------------------------------------------------------------ */

/** `YYYY-MM-DD` for a Date, in local time — never UTC-shifted. */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/* ------------------------------------------------------------------------ */
/* Progress                                                                  */
/* ------------------------------------------------------------------------ */

/** Percentage of the *current stage's* checklist that is done. */
export function stageProgress(c: Container): number {
  const items = c.checklist.filter((t) => t.stage === c.stage);
  if (!items.length) return 100;
  return Math.round((items.filter((t) => t.done).length / items.length) * 100);
}

/** Percentage of the whole checklist that is done. */
export function overallProgress(c: Container): number {
  if (!c.checklist.length) return 0;
  return Math.round((c.checklist.filter((t) => t.done).length / c.checklist.length) * 100);
}

export function daysInStage(c: Container, today: string): number {
  return daysBetween(c.stageEntered, today);
}

export function budgetFor(c: Container): number {
  return stageBudget(c.type, c.stage);
}

export function totalPlanDaysFor(c: Container): number {
  return STAGES.reduce((total, s) => total + s.days + extraDaysForStage(c.type, s.id), 0);
}

/**
 * Over its stage budget. Final QC is excluded: a container waiting for release
 * is not "delayed in a stage", it is finished work waiting on a gate pass.
 */
export function isLate(c: Container, today: string): boolean {
  return daysInStage(c, today) > budgetFor(c) && c.stage !== FINAL_STAGE;
}

export function isReady(c: Container): boolean {
  return c.stage === FINAL_STAGE && overallProgress(c) === 100;
}

export function daysOverBudget(c: Container, today: string): number {
  return Math.max(0, daysInStage(c, today) - budgetFor(c));
}

/* ------------------------------------------------------------------------ */
/* Status — colour, icon and word travel together                            */
/* ------------------------------------------------------------------------ */

/**
 * Design system rule 12: status is never colour alone.
 *
 * Every status in the product resolves through here, so a screen physically
 * cannot render a bare coloured dot or a red number — it gets a tone, an icon
 * and a word, or it gets nothing.
 *
 * `tone` maps to the design system's pill modifiers (section 26).
 */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';

export interface Status {
  tone: StatusTone;
  /** Icon name from the design system sprite. */
  icon: string;
  label: string;
  /** Long form for screen readers and tooltips. */
  detail: string;
}

export function containerStatus(c: Container, today: string): Status {
  if (isReady(c)) {
    return {
      tone: 'ok',
      icon: 'check-circle',
      label: 'Ready for release',
      detail: 'Every checklist item is complete and the unit is cleared for gate-out.',
    };
  }
  if (isLate(c, today)) {
    const over = daysOverBudget(c, today);
    return {
      tone: 'bad',
      icon: 'alert',
      label: `Delayed ${over}d`,
      detail: `${daysInStage(c, today)} days in ${STAGE_BY_ID[c.stage].name}, against a ${budgetFor(c)} day budget.`,
    };
  }
  if (daysInStage(c, today) === budgetFor(c) && c.stage !== FINAL_STAGE) {
    return {
      tone: 'warn',
      icon: 'clock',
      label: 'Due today',
      detail: `Last day of the ${budgetFor(c)} day budget for ${STAGE_BY_ID[c.stage].name}.`,
    };
  }
  return {
    tone: 'info',
    icon: 'refresh',
    label: 'On track',
    detail: `${daysInStage(c, today)} of ${budgetFor(c)} days in ${STAGE_BY_ID[c.stage].name}.`,
  };
}

export function priorityStatus(priority: Priority): Status {
  switch (priority) {
    case 'Urgent':
      return {
        tone: 'bad',
        icon: 'alert',
        label: 'Urgent',
        detail: 'Highest priority — schedule ahead of everything else.',
      };
    case 'High':
      return {
        tone: 'warn',
        icon: 'arrow-up',
        label: 'High',
        detail: 'Above standard priority.',
      };
    default:
      return {
        tone: 'neutral',
        icon: 'minus',
        label: 'Standard',
        detail: 'Normal scheduling.',
      };
  }
}

export function gradeStatus(grade: Grade): Status {
  const map: Record<Grade, Status> = {
    A: { tone: 'ok', icon: 'check-circle', label: 'Grade A', detail: 'Like new — minimal repair expected.' },
    B: { tone: 'info', icon: 'info', label: 'Grade B', detail: 'Minor cosmetic work expected.' },
    C: { tone: 'warn', icon: 'alert', label: 'Grade C', detail: 'Repairable damage — plan workshop capacity.' },
    D: { tone: 'bad', icon: 'breach', label: 'Grade D', detail: 'Major or structural damage — plan heavy repair.' },
  };
  return map[grade];
}

/* ------------------------------------------------------------------------ */
/* Tomorrow's work                                                           */
/* ------------------------------------------------------------------------ */

export interface QueuedTask {
  container: Container;
  task: ChecklistItem;
}

const PRIORITY_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Standard: 2 };

/**
 * Every open task in every container's *current* stage — the work that has to
 * happen next for the pipeline to move. Delayed containers first, then by
 * priority.
 */
export function tomorrowTasks(containers: readonly Container[], today: string): QueuedTask[] {
  const out: QueuedTask[] = [];
  for (const container of containers) {
    if (isReady(container)) continue;
    for (const task of container.checklist) {
      if (task.stage === container.stage && !task.done) out.push({ container, task });
    }
  }
  return out.sort((a, b) => {
    const lateA = isLate(a.container, today) ? 0 : 1;
    const lateB = isLate(b.container, today) ? 0 : 1;
    if (lateA !== lateB) return lateA - lateB;
    return PRIORITY_RANK[a.container.priority] - PRIORITY_RANK[b.container.priority];
  });
}

/** Average recorded hours for a task across the whole fleet. */
export function averageHoursFor(containers: readonly Container[], key: string): number {
  const all = containers.flatMap((c) => c.checklist.filter((t) => t.key === key).map((t) => t.hrs));
  if (!all.length) return 0;
  return Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10;
}

/* ------------------------------------------------------------------------ */
/* Order to inventory matching                                               */
/* ------------------------------------------------------------------------ */

export interface OrderMatch {
  order: Order;
  container: Container | null;
  /** Outstanding tasks on the matched container, null when unmatched. */
  remaining: ChecklistItem[] | null;
  ready: boolean;
  /** Candidates at other depots that could be transferred in. */
  elsewhereCount: number;
  status: Status;
}

/**
 * Greedy match: for each order, take the home-depot container of the right
 * type and size that is furthest along. If there is none at home, report how
 * many exist elsewhere in the network so a transfer can be considered.
 */
export function matchOrders(
  orders: readonly Order[],
  containers: readonly Container[],
  homeDepot: string
): OrderMatch[] {
  const used = new Set<string>();

  return orders.map((order) => {
    const home = containers
      .filter(
        (c) => c.type === order.type && c.size === order.size && c.depot === homeDepot && !used.has(c.id)
      )
      .sort((a, b) => overallProgress(b) - overallProgress(a));

    const best = home[0];
    if (best) {
      used.add(best.id);
      const remaining = best.checklist.filter((t) => !t.done);
      const ready = isReady(best);
      return {
        order,
        container: best,
        remaining,
        ready,
        elsewhereCount: 0,
        status: ready
          ? { tone: 'ok', icon: 'check-circle', label: 'Matched · ready', detail: 'Nothing outstanding on the matched unit.' }
          : {
              tone: 'brand',
              icon: 'refresh',
              label: 'Matched · in progress',
              detail: `${remaining.length} task${remaining.length === 1 ? '' : 's'} outstanding on ${best.id}.`,
            },
      };
    }

    const elsewhereCount = containers.filter(
      (c) => c.type === order.type && c.size === order.size && c.depot !== homeDepot && !used.has(c.id)
    ).length;

    return {
      order,
      container: null,
      remaining: null,
      ready: false,
      elsewhereCount,
      status: {
        tone: 'bad',
        icon: 'x-circle',
        label: 'Unmatched',
        detail: elsewhereCount
          ? `${elsewhereCount} candidate${elsewhereCount === 1 ? '' : 's'} at other depots — consider a transfer.`
          : 'Nothing suitable anywhere in the network — this needs sourcing.',
      },
    };
  });
}

/* ------------------------------------------------------------------------ */
/* Misc                                                                      */
/* ------------------------------------------------------------------------ */

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function typeLabel(c: Pick<Container, 'type' | 'anteroomVariant'>, labels: Record<ContainerType, string>): string {
  const base = labels[c.type];
  if (c.type !== 'anteroom' || !c.anteroomVariant) return base;
  return `${base} · ${c.anteroomVariant === 'external' ? 'External' : 'Internal'}`;
}

/** Stage ordering helper for grouping a checklist back into stages. */
export function byStageOrder<T extends { stage: StageId }>(a: T, b: T): number {
  return stageIndex(a.stage) - stageIndex(b.stage);
}
