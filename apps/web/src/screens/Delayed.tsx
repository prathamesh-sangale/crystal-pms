import {
  STAGE_BY_ID,
  budgetFor,
  containerStatus,
  daysInStage,
  daysOverBudget,
  isLate,
  overallProgress,
  priorityStatus,
  type Container,
} from '@pms/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ContainerGauge } from '../components/app/ContainerGauge';
import { Person, StatusPill } from '../components/crystal/Data';
import { DataTable } from '../components/crystal/DataTable';
import { AsyncRegion, EmptyState, TableSkeleton } from '../components/crystal/Feedback';
import { useOverview } from '../lib/queries';

const column = createColumnHelper<Container & { today: string }>();

export function Delayed(): React.ReactElement {
  const query = useOverview();
  const [, setParams] = useSearchParams();
  const o = query.data;

  const rows = useMemo(
    () =>
      o
        ? o.containers.filter((c) => isLate(c, o.today)).map((c) => ({ ...c, today: o.today }))
        : [],
    [o]
  );

  const columns = useMemo(
    () => [
      column.accessor('id', {
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (info) => <span className="mono">{info.getValue()}</span>,
      }),
      column.accessor((row) => STAGE_BY_ID[row.stage].name, {
        id: 'stage',
        header: 'Stuck in',
        meta: { label: 'Stuck in' },
      }),
      column.accessor((row) => daysOverBudget(row, row.today), {
        id: 'over',
        header: 'Over by',
        meta: { label: 'Over by' },
        cell: (info) => <StatusPill status={containerStatus(info.row.original, info.row.original.today)} />,
      }),
      column.accessor((row) => daysInStage(row, row.today), {
        id: 'days',
        header: 'Days in stage',
        meta: { label: 'Days in stage', num: true, secondary: true },
        cell: (info) => (
          <span className="mono">
            {info.getValue()} / {budgetFor(info.row.original)}
          </span>
        ),
      }),
      column.accessor((row) => overallProgress(row), {
        id: 'progress',
        header: 'Readiness',
        meta: { label: 'Readiness', secondary: true },
        cell: (info) => <ContainerGauge container={info.row.original} size="sm" />,
      }),
      column.accessor('assignee', {
        header: 'Owner',
        meta: { label: 'Owner' },
        cell: (info) => <Person name={info.getValue()} />,
      }),
      column.accessor('priority', {
        header: 'Priority',
        meta: { label: 'Priority' },
        cell: (info) => <StatusPill status={priorityStatus(info.getValue())} />,
      }),
    ],
    []
  );

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={<TableSkeleton rows={4} columns={6} />}
    >
      {o && (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption="Containers past their stage day budget"
          rowLabel={(row) => `open ${row.id}`}
          onRowOpen={(row) =>
            setParams((params) => {
              params.set('container', row.id);
              return params;
            })
          }
          initialSort={[{ id: 'over', desc: true }]}
          empty={
            <EmptyState icon="check-circle" title="Nothing is delayed">
              Every container is inside the day budget for the stage it is in. A container appears
              here the day it goes over.
            </EmptyState>
          }
        />
      )}
    </AsyncRegion>
  );
}
