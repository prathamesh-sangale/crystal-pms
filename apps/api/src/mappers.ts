import {
  TASK_TEMPLATES,
  toISODate,
  type AnteroomVariant,
  type ChecklistItem,
  type Container,
  type ContainerSize,
  type ContainerType,
  type Grade,
  type OffLeaseUnit,
  type Order,
  type Priority,
  type StageId,
} from '@pms/shared';
import type { Prisma } from '@prisma/client';

/** Everything a container needs to be returned in full. */
export const containerInclude = {
  depot: true,
  technician: true,
  tasks: true,
} satisfies Prisma.ContainerInclude;

type ContainerRow = Prisma.ContainerGetPayload<{ include: typeof containerInclude }>;

/** Template order, so the checklist always renders gate-in first and QC last. */
const TASK_ORDER = new Map(TASK_TEMPLATES.map((t, i) => [t.key, i]));

export function toContainer(row: ContainerRow): Container {
  const checklist: ChecklistItem[] = row.tasks
    .slice()
    .sort((a, b) => (TASK_ORDER.get(a.key) ?? 0) - (TASK_ORDER.get(b.key) ?? 0))
    .map((t) => ({
      key: t.key,
      stage: t.stage as StageId,
      label: t.label,
      hrs: t.hrs,
      onlyFor: t.onlyFor ? (JSON.parse(t.onlyFor) as ContainerType[]) : null,
      done: t.done,
      doneAt: t.doneAt ? t.doneAt.toISOString() : null,
      doneBy: t.doneBy,
    }));

  return {
    id: row.id,
    size: row.size as ContainerSize,
    type: row.type as ContainerType,
    anteroomVariant: (row.anteroomVariant as AnteroomVariant | null) ?? null,
    customer: row.customer,
    priority: row.priority as Priority,
    assignee: row.technician.name,
    depot: row.depot.name,
    stage: row.stage as StageId,
    received: toISODate(row.received),
    stageEntered: toISODate(row.stageEntered),
    notes: row.notes,
    checklist,
  };
}

export function toOffLease(row: Prisma.OffLeaseUnitGetPayload<{ include: { depot: true } }>): OffLeaseUnit {
  return {
    id: row.id,
    customer: row.customer,
    size: row.size as ContainerSize,
    type: row.type as ContainerType,
    expected: toISODate(row.expected),
    depot: row.depot.name,
    grade: row.grade as Grade,
    notes: row.notes,
  };
}

export function toOrder(row: Prisma.CustomerOrderGetPayload<object>): Order {
  return {
    id: row.id,
    customer: row.customer,
    size: row.size as ContainerSize,
    type: row.type as ContainerType,
    qty: row.qty,
    needBy: toISODate(row.needBy),
    requirement: row.requirement,
  };
}

/** `YYYY-MM-DD` at local midnight, so a date column never drifts a day. */
export function atLocalMidnight(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}
