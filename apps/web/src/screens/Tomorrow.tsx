import {
  STAGE_BY_ID,
  averageHoursFor,
  containerStatus,
  isLate,
  tomorrowTasks,
  type ChecklistItem,
  type Container,
} from '@pms/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Person, StatCard, StatusPill } from '../components/crystal/Data';
import { DataTable } from '../components/crystal/DataTable';
import { AsyncRegion, EmptyState, TableSkeleton } from '../components/crystal/Feedback';
import { formatHours, plural } from '../lib/format';
import { useOverview, useReference } from '../lib/queries';

interface QueueRow {
  id: string;
  container: Container;
  task: ChecklistItem;
  backup: string;
  average: number;
  today: string;
}

const column = createColumnHelper<QueueRow>();

/**
 * The work that has to happen next, and who does it if the named person is
 * unavailable. Delayed containers sort to the top.
 */
export function Tomorrow(): React.ReactElement {
  const query = useOverview();
  const reference = useReference();
  const [, setParams] = useSearchParams();

  const backups = useMemo(() => {
    const map = new Map<string, string>();
    for (const tech of reference.data?.technicians ?? []) {
      if (tech.backup) map.set(tech.name, tech.backup);
    }
    return map;
  }, [reference.data]);

  const rows = useMemo<QueueRow[]>(() => {
    if (!query.data) return [];
    const { containers, today } = query.data;
    return tomorrowTasks(containers, today).map(({ container, task }) => ({
      id: `${container.id}::${task.key}`,
      container,
      task,
      backup: backups.get(container.assignee) ?? '—',
      average: averageHoursFor(containers, task.key),
      today,
    }));
  }, [query.data, backups]);

  const columns = useMemo(
    () => [
      column.accessor((row) => row.container.id, {
        id: 'container',
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (info) => <span className="mono">{info.getValue()}</span>,
      }),
      column.accessor((row) => row.task.label, {
        id: 'task',
        header: 'Task',
        meta: { label: 'Task' },
      }),
      column.accessor((row) => STAGE_BY_ID[row.task.stage].name, {
        id: 'stage',
        header: 'Stage',
        meta: { label: 'Stage', secondary: true },
      }),
      column.accessor((row) => row.container.assignee, {
        id: 'assignee',
        header: 'Owner',
        meta: { label: 'Owner' },
        cell: (info) => <Person name={info.getValue()} />,
      }),
      column.accessor((row) => row.backup, {
        id: 'backup',
        header: 'Cover',
        meta: { label: 'Cover', secondary: true },
      }),
      column.accessor((row) => row.task.hrs, {
        id: 'hrs',
        header: 'Est.',
        meta: { label: 'Estimate', num: true, secondary: true },
        cell: (info) => (
          <span className="mono">
            {formatHours(info.getValue())}
            {info.row.original.average !== info.getValue() && (
              <span className="subtle"> (avg {formatHours(info.row.original.average)})</span>
            )}
          </span>
        ),
      }),
      column.display({
        id: 'status',
        header: 'Status',
        meta: { label: 'Status' },
        cell: (info) => (
          <StatusPill
            status={containerStatus(info.row.original.container, info.row.original.today)}
          />
        ),
      }),
    ],
    []
  );

  const o = query.data;
  const totalHours = rows.reduce((a, r) => a + r.task.hrs, 0);
  const owners = new Set(rows.map((r) => r.container.assignee));
  const lateRows = o ? rows.filter((r) => isLate(r.container, o.today)).length : 0;

  return (
    <AsyncRegion
      loading={query.isLoading || reference.isLoading}
      error={query.error ?? reference.error}
      onRetry={() => void query.refetch()}
      skeleton={
        <div className="stack stack-loose">
          <div className="cardgrid stagger">
            {[0, 1, 2, 3].map((i) => (
              <StatCard key={i} label="" value="" loading />
            ))}
          </div>
          <TableSkeleton rows={6} columns={6} />
        </div>
      }
    >
      {o && (
        <>
          <div className="cardgrid stagger">
            <StatCard
              icon="list"
              label="Open tasks required next"
              value={rows.length}
              foot={`across ${plural(new Set(rows.map((r) => r.container.id)).size, 'container')}`}
            />
            <StatCard
              icon="clock"
              label="Estimated labour"
              value={formatHours(Math.round(totalHours * 10) / 10)}
              foot="sum of task estimates"
            />
            <StatCard
              icon="user"
              label="Technicians needed"
              value={owners.size}
              foot="each with a named cover"
            />
            <StatCard
              icon="alert"
              label="In delayed containers"
              value={lateRows}
              foot="do these first"
            />
          </div>

          <DataTable
            data={rows}
            columns={columns}
            getRowId={(row) => row.id}
            caption="Tasks required next, by container"
            rowLabel={(row) => `open ${row.container.id}`}
            onRowOpen={(row) =>
              setParams((params) => {
                params.set('container', row.container.id);
                return params;
              })
            }
            pageSize={15}
            empty={
              <EmptyState icon="check-circle" title="Nothing outstanding">
                Every container&rsquo;s current-stage checklist is complete. The next work appears
                here as soon as a container advances.
              </EmptyState>
            }
          />
        </>
      )}
    </AsyncRegion>
  );
}
