import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { ContainerDetailDrawer } from '../../components/v2/ContainerDetailDrawer';
import {
  agingStatus,
  isReadyToMove,
  openTaskCount,
  overallStatus,
  SECTION_LABELS,
  sectionStatus,
  TYPE_CODES,
  type MockContainer,
} from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { Button, Segmented } from '../../components/crystal/Button';
import { CategoryBadge, StatCard, StatusPill } from '../../components/crystal/Data';
import { DateTimePicker } from '../../components/crystal/DateTimePicker';
import { Chip } from '../../components/crystal/Form';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { Icon, type IconName } from '../../components/crystal/Icon';

type Filter = 'all' | 'survey' | 'progress' | 'ready';
type DisplayMode = 'cards' | 'list';

const columnHelper = createColumnHelper<MockContainer>();

/** One icon per real Type code (TYPE_CODES, mockV2.ts) — same order the
 * breakdown row renders in. A plain `Record<string, IconName>` rather than
 * keying off `typeof TYPE_CODES[number]`, since TYPE_CODES itself is a
 * plain `string[]` (no `as const`), not a literal union. */
const TYPE_ICON: Record<string, IconName> = {
  Dry: 'package',
  Reefer: 'snow',
  'ISO Tank': 'drop',
  'Porta Cabin': 'home',
};

/** A minimal card, not a two-block stat card with its own large numbers each
 * — the first version (two 19px numbers side by side with a divider) was
 * wide enough that six of them (plus "Total containers") wrapped onto a
 * second row; a row-based table fixed the space problem but the user wanted
 * cards back, just not that wide. Both counts on one compact text line, same
 * padding as the plain StatCard beside it, so six of these plus Total still
 * reads as one deliberate row of peers, not a mix of two card styles. */
function TypeBreakdownCard({
  icon,
  label,
  ready,
  progress,
}: {
  icon: IconName;
  label: string;
  ready: number;
  progress: number;
}): React.ReactElement {
  return (
    <div className="card">
      <span className="klabel">
        <Icon name={icon} size="sm" />
        {label}
      </span>
      <div style={{ marginTop: '9px', fontSize: '12.5px' }}>
        <span style={{ fontWeight: 700, color: 'var(--success)' }}>{ready}</span>
        <span className="subtle"> ready · </span>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{progress}</span>
        <span className="subtle"> in progress</span>
      </div>
    </div>
  );
}

export function YardBoard(): React.ReactElement {
  const {
    containers,
    activeContainers,
    workers,
    startTask,
    stopTask,
    cancelTask,
    markTaskNA,
    assignWorker,
    scheduleTask,
    setTaskSite,
    markReady,
    pendingOpenId,
    clearPendingOpen,
    updateContainer,
    removeContainer,
    setPriority,
    gateOut,
  } = useV2Data();
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [workerFilter, setWorkerFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const toast = useToast();

  const anyAdvancedFilter = Boolean(workerFilter || dateFrom || dateTo);
  const clearAdvancedFilters = (): void => {
    setWorkerFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const open = containers.find((c) => c.id === openId) ?? null;

  // The "New container" action lives in the top bar (shared across every v2
  // screen, not just this one) — when it gates a container in, open that
  // container's drawer here, same as if it had been added from this screen.
  useEffect(() => {
    if (pendingOpenId && containers.some((c) => c.id === pendingOpenId)) {
      setOpenId(pendingOpenId);
      clearPendingOpen();
    }
  }, [pendingOpenId, containers, clearPendingOpen]);

  const counts = useMemo(() => {
    let survey = 0;
    let progress = 0;
    let ready = 0;
    // One ready/progress pair per real Type code (TYPE_CODES), not just a
    // Dry/Reefer binary — ISO Tank/Porta Cabin containers were previously
    // silently counted as "Dry" here, a leftover from before SPEC.md §8
    // item 9 resolved the real Type list.
    const byType = new Map<string, { ready: number; progress: number }>(TYPE_CODES.map((t) => [t, { ready: 0, progress: 0 }]));
    for (const c of activeContainers) {
      if (!c.survey) {
        survey += 1;
        continue;
      }
      // typeCode is a compound string on hand-authored demo containers (e.g.
      // "Reefer · Double-compressor"), a plain TYPE_CODES value on anything
      // gated in through the form since — startsWith matches both. There's
      // no "Other" catch-all bucket (removed, not a real product here) —
      // a typeCode matching none of TYPE_CODES (currently impossible, since
      // intake only ever offers these four) still counts toward the
      // top-line ready/progress totals below, just isn't attributed to any
      // specific type card, rather than being guessed into the wrong one.
      const type = TYPE_CODES.find((t) => c.typeCode.startsWith(t));
      const bucket = type ? byType.get(type)! : null;
      if (c.readyAt || isReadyToMove(c)) {
        ready += 1;
        if (bucket) bucket.ready += 1;
      } else {
        progress += 1;
        if (bucket) bucket.progress += 1;
      }
    }
    return { total: activeContainers.length, survey, progress, ready, byType };
  }, [activeContainers]);

  const rows = useMemo(() => {
    const filtered = activeContainers.filter((c) => {
      if (filter === 'all') return true;
      if (filter === 'survey') return !c.survey;
      if (filter === 'ready') return Boolean(c.readyAt) || isReadyToMove(c);
      return Boolean(c.survey) && !c.readyAt && !isReadyToMove(c);
    });
    const advanced = filtered.filter((c) => {
      if (workerFilter && !c.sections.some((s) => s.tasks.some((t) => t.workerId === workerFilter))) return false;
      if (dateFrom || dateTo) {
        if (!c.survey) return false;
        // Date objects, not string comparison — performedAt is a plain date
        // on old mock containers but a full timestamp on anything surveyed
        // through the intake form since, and the two don't sort correctly
        // against each other as strings.
        const performedMs = new Date(c.survey.performedAt).getTime();
        if (dateFrom && performedMs < new Date(dateFrom).getTime()) return false;
        if (dateTo && performedMs > new Date(dateTo).getTime()) return false;
      }
      return true;
    });
    // Fast-tracked containers first — a flag nobody has to scroll past the
    // rest of the yard to notice.
    return [...advanced].sort((a, b) => Number(b.priority) - Number(a.priority));
  }, [activeContainers, filter, workerFilter, dateFrom, dateTo]);

  const handleMarkReady = (id: string): void => {
    markReady(id);
    toast.ok('Ready to move', `${id} cleared for release.`);
  };

  const columns = useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (ctx) => (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <span className="mono">{ctx.getValue()}</span>
            {ctx.row.original.priority && <StatusPill status={{ tone: 'bad', icon: 'alert', label: 'Fast-track', detail: 'Flagged to handle ahead of normal work.' }} />}
          </span>
        ),
      }),
      columnHelper.accessor('typeCode', {
        header: 'Type',
        meta: { label: 'Type' },
        cell: (ctx) => <CategoryBadge>{ctx.getValue()}</CategoryBadge>,
      }),
      columnHelper.display({
        id: 'status',
        header: 'Status',
        meta: { label: 'Status' },
        cell: (ctx) => <StatusPill status={overallStatus(ctx.row.original)} />,
      }),
      columnHelper.display({
        id: 'sections',
        header: 'Sections',
        meta: { label: 'Sections', secondary: true },
        cell: (ctx) => {
          const c = ctx.row.original;
          return c.sections.length > 0 ? (
            <span className="cluster" style={{ gap: 'var(--s-2)' }}>
              {c.sections.map((s) => (
                <StatusPill key={s.kind} status={{ ...sectionStatus(s), label: `${SECTION_LABELS[s.kind]} ${sectionStatus(s).label}` }} />
              ))}
            </span>
          ) : (
            <span className="subtle">{c.survey ? 'No sections required' : 'Not yet surveyed'}</span>
          );
        },
      }),
      columnHelper.display({
        id: 'openTasks',
        header: 'Open tasks',
        meta: { label: 'Open tasks', num: true },
        cell: (ctx) => openTaskCount(ctx.row.original),
      }),
      columnHelper.display({
        id: 'aging',
        header: 'Aging',
        meta: { label: 'Aging', secondary: true },
        cell: (ctx) => {
          const status = agingStatus(ctx.row.original);
          return status ? <StatusPill status={status} /> : <span className="subtle">—</span>;
        },
      }),
    ],
    []
  );

  return (
    <div className="stack stack-loose">
      <div className="yardtype-row stagger">
        <StatCard label="Total containers" value={counts.total} icon="warehouse" />
        {TYPE_CODES.map((type) => (
          <TypeBreakdownCard
            key={type}
            icon={TYPE_ICON[type] ?? 'package'}
            label={type}
            ready={counts.byType.get(type)?.ready ?? 0}
            progress={counts.byType.get(type)?.progress ?? 0}
          />
        ))}
      </div>

      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <div className="cluster">
          <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All ({counts.total})
          </Chip>
          <Chip pressed={filter === 'survey'} onClick={() => setFilter('survey')} icon="doc">
            Awaiting survey ({counts.survey})
          </Chip>
          <Chip pressed={filter === 'progress'} onClick={() => setFilter('progress')} icon="clock">
            In progress ({counts.progress})
          </Chip>
          <Chip pressed={filter === 'ready'} onClick={() => setFilter('ready')} icon="check-circle">
            Ready to move ({counts.ready})
          </Chip>
        </div>
        <Segmented
          value={displayMode}
          onChange={setDisplayMode}
          label="Display as"
          options={[
            { value: 'cards', label: 'Cards' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>

      <div
        className="cluster"
        style={{
          gap: 'var(--s-3)',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: 'var(--s-3)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
        }}
      >
        <select
          className="input"
          style={{ width: '180px', height: '40px', padding: '8px 10px', fontSize: '12.5px' }}
          value={workerFilter}
          onChange={(e) => setWorkerFilter(e.target.value)}
        >
          <option value="">Any worker</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <span className="cluster" style={{ gap: 'var(--s-2)' }}>
          <span className="subtle" style={{ fontSize: '12px' }}>
            Surveyed
          </span>
          <DateTimePicker value={dateFrom} onChange={setDateFrom} />
          <span className="subtle" style={{ fontSize: '12px' }}>
            to
          </span>
          <DateTimePicker value={dateTo} onChange={setDateTo} />
        </span>
        {anyAdvancedFilter && (
          <Button variant="ghost" size="sm" icon="x" onClick={clearAdvancedFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="warehouse" title="Nothing in this view">
          Try a different filter, or use New container in the top bar to register an arrival.
        </EmptyState>
      ) : displayMode === 'list' ? (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(c) => c.id}
          caption="Containers in the yard"
          pageSize={10}
          onRowOpen={(c) => setOpenId(c.id)}
          rowLabel={(c) => c.id}
          empty={<EmptyState icon="warehouse" title="Nothing in this view">Try a different filter.</EmptyState>}
        />
      ) : (
        // CSS multi-column, not CSS Grid: a grid row's height is always set by
        // its tallest cell, so even with alignItems:'start' a short card (e.g.
        // "Not yet surveyed") still leaves bare background space under it
        // until the next row starts — real content varies too much in length
        // here for row-locking to ever look packed. Columns let each card
        // stack directly under the next regardless of its neighbors' height.
        <div style={{ columnWidth: '280px', columnGap: 'var(--s-4)' }}>
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              className="card hoverable"
              style={{
                textAlign: 'left',
                display: 'block',
                width: '100%',
                borderColor: c.priority ? 'var(--error)' : undefined,
                breakInside: 'avoid',
                marginBottom: 'var(--s-4)',
              }}
              onClick={() => setOpenId(c.id)}
            >
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                  <span
                    className="mono"
                    style={{
                      fontWeight: 700,
                      fontSize: '13px',
                      color: 'var(--text)',
                      padding: '3px 8px',
                      background: 'var(--surface)',
                      border: '1px solid var(--line-strong)',
                      borderRadius: 'var(--r-sm)',
                    }}
                  >
                    {c.id}
                  </span>
                  {c.priority && <StatusPill status={{ tone: 'bad', icon: 'alert', label: 'Fast-track', detail: 'Flagged to handle ahead of normal work.' }} />}
                </span>
                <StatusPill status={overallStatus(c)} />
              </div>
              <div className="cluster" style={{ gap: 'var(--s-2)', margin: 'var(--s-2) 0 var(--s-3)' }}>
                <CategoryBadge>{c.typeCode}</CategoryBadge>
              </div>

              {c.sections.length > 0 ? (
                <div className="cluster" style={{ gap: 'var(--s-2)' }}>
                  {c.sections.map((s) => (
                    <StatusPill key={s.kind} status={{ ...sectionStatus(s), label: `${SECTION_LABELS[s.kind]} ${sectionStatus(s).label}` }} />
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '12.5px', color: 'var(--text)', margin: 0 }}>
                  {c.survey ? 'No sections required.' : 'Not yet surveyed.'}
                </p>
              )}

              {openTaskCount(c) > 0 && (
                <div style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 600, marginTop: 'var(--s-2)' }}>
                  {openTaskCount(c)} open task{openTaskCount(c) === 1 ? '' : 's'}
                </div>
              )}
              {agingStatus(c) && (
                <div style={{ marginTop: 'var(--s-2)' }}>
                  <StatusPill status={agingStatus(c)!} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <ContainerDetailDrawer
        container={open}
        workers={workers}
        containers={containers}
        onOpenChange={(next) => !next && setOpenId(null)}
        onStart={startTask}
        onStop={stopTask}
        onCancel={cancelTask}
        onMarkNA={markTaskNA}
        onAssignWorker={assignWorker}
        onScheduleTask={scheduleTask}
        onSetTaskSite={setTaskSite}
        onMarkReady={handleMarkReady}
        onUpdateContainer={updateContainer}
        onRemoveContainer={removeContainer}
        onSetPriority={setPriority}
        onGateOut={gateOut}
      />
    </div>
  );
}
