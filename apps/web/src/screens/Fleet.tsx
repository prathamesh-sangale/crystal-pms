import {
  STAGE_BY_ID,
  TYPE_LABELS,
  containerStatus,
  isLate,
  isReady,
  overallProgress,
  typeLabel,
  type Container,
} from '@pms/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ContainerGauge } from '../components/app/ContainerGauge';
import { CategoryBadge, Person, StatusPill } from '../components/crystal/Data';
import { DataTable } from '../components/crystal/DataTable';
import { AsyncRegion, EmptyState, TableSkeleton } from '../components/crystal/Feedback';
import { Chip, InputWithIcon } from '../components/crystal/Form';
import { useOverview } from '../lib/queries';

type Filter = 'all' | 'active' | 'late' | 'ready';

const column = createColumnHelper<Container & { today: string }>();

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In progress' },
  { value: 'late', label: 'Delayed' },
  { value: 'ready', label: 'Ready' },
];

export function Fleet(): React.ReactElement {
  const query = useOverview();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const o = query.data;

  const rows = useMemo(() => {
    if (!o) return [];
    const q = search.trim().toLowerCase();
    return o.containers
      .filter((c) => {
        if (filter === 'late' && !isLate(c, o.today)) return false;
        if (filter === 'ready' && !isReady(c)) return false;
        if (filter === 'active' && isReady(c)) return false;
        if (!q) return true;
        return (
          c.id.toLowerCase().includes(q) ||
          c.customer.toLowerCase().includes(q) ||
          c.assignee.toLowerCase().includes(q) ||
          c.depot.toLowerCase().includes(q)
        );
      })
      .map((c) => ({ ...c, today: o.today }));
  }, [o, search, filter]);

  const columns = useMemo(
    () => [
      column.accessor('id', {
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (info) => <span className="mono">{info.getValue()}</span>,
      }),
      column.accessor((row) => typeLabel(row, TYPE_LABELS), {
        id: 'type',
        header: 'Type',
        meta: { label: 'Type', secondary: true },
        cell: (info) => (
          <CategoryBadge variant={info.row.original.type === 'standard' ? 'neutral' : 'brand'}>
            {info.getValue()}
          </CategoryBadge>
        ),
      }),
      column.accessor((row) => STAGE_BY_ID[row.stage].name, {
        id: 'stage',
        header: 'Stage',
        meta: { label: 'Stage' },
      }),
      column.accessor((row) => overallProgress(row), {
        id: 'progress',
        header: 'Readiness',
        meta: { label: 'Readiness' },
        cell: (info) => <ContainerGauge container={info.row.original} size="sm" />,
      }),
      column.accessor('customer', {
        header: 'Customer',
        meta: { label: 'Customer' },
      }),
      column.accessor('depot', {
        header: 'Depot',
        meta: { label: 'Depot', secondary: true },
      }),
      column.accessor('assignee', {
        header: 'Technician',
        meta: { label: 'Technician', secondary: true },
        cell: (info) => <Person name={info.getValue()} />,
      }),
      column.display({
        id: 'status',
        header: 'Status',
        meta: { label: 'Status' },
        cell: (info) => (
          <StatusPill status={containerStatus(info.row.original, info.row.original.today)} />
        ),
      }),
    ],
    []
  );

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={<TableSkeleton rows={8} columns={6} />}
    >
      {o && (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(row) => row.id}
          caption="Every container in the register"
          rowLabel={(row) => `open ${row.id}`}
          onRowOpen={(row) =>
            setParams((current) => {
              current.set('container', row.id);
              return current;
            })
          }
          toolbar={
            <>
              <div style={{ width: '260px', maxWidth: '100%' }}>
                <InputWithIcon
                  icon="search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Unit number, customer, technician…"
                  aria-label="Search containers"
                />
              </div>
              <div className="cluster" role="group" aria-label="Filter by status">
                {FILTERS.map((option) => (
                  <Chip
                    key={option.value}
                    pressed={filter === option.value}
                    onClick={() => setFilter(option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
              <span className="mono subtle" style={{ marginLeft: 'auto', fontSize: '11px' }}>
                {rows.length} of {o.containers.length}
              </span>
            </>
          }
          empty={
            search || filter !== 'all' ? (
              <EmptyState
                icon="filter"
                title="No containers match this view"
                action={
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                      setParams(new URLSearchParams(params.get('container') ? { container: params.get('container') as string } : {}));
                    }}
                  >
                    Clear search and filters
                  </button>
                }
              >
                Nothing matches {search ? `“${search}”` : 'this filter'}. Clear it to see all{' '}
                {o.containers.length} containers.
              </EmptyState>
            ) : (
              <EmptyState icon="container" title="The register is empty">
                Every container that has been gated in appears here, whatever depot it sits at.
              </EmptyState>
            )
          }
        />
      )}
    </AsyncRegion>
  );
}
