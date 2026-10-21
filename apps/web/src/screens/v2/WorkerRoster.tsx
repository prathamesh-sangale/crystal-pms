import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isScheduledFor, offsetDate, overallStatus, tasksForWorker, WORKER_TYPE_LABELS, WORKER_TYPES, type MockContainer, type MockWorker, type WorkerType } from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { AssignWorkDialog } from '../../components/v2/AssignWorkDialog';
import { WorkerDetailDrawer } from '../../components/v2/WorkerDetailDrawer';
import { Button, Segmented } from '../../components/crystal/Button';
import { CategoryBadge, StatusPill } from '../../components/crystal/Data';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { Field, InputWithIcon } from '../../components/crystal/Form';
import { Modal } from '../../components/crystal/Overlay';

const helper = createColumnHelper<MockWorker>();
const containerHelper = createColumnHelper<MockContainer>();

const EMPTY_DRAFT = { name: '', type: 'painter' as WorkerType, notes: '' };
type DisplayMode = 'cards' | 'list';
/** "staff par container search ka tab do" -- a second tab on this screen,
 * separate from the worker list, so finding a container doesn't require
 * going through Assign Work. */
type RosterView = 'workers' | 'containers';

export function WorkerRoster(): React.ReactElement {
  const { workers, containers, addWorker, updateWorker, removeWorker, toggleWorkerActive, assignWorker, scheduleTask, unassignTask, addTask } = useV2Data();
  const [view, setView] = useState<RosterView>('workers');
  const [typeFilter, setTypeFilter] = useState<WorkerType | 'all'>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [openId, setOpenId] = useState<string | null>(null);
  // Assigning directly from a roster row — no need to open the full profile
  // drawer first, same as the crew table on Live Board.
  const [assignWorkerId, setAssignWorkerId] = useState<string | null>(null);
  const [containerQuery, setContainerQuery] = useState('');
  const toast = useToast();
  const navigate = useNavigate();

  const rows = useMemo(() => (typeFilter === 'all' ? workers : workers.filter((w) => w.type === typeFilter)), [workers, typeFilter]);
  const openWorker = workers.find((w) => w.id === openId) ?? null;

  const containerRows = useMemo(() => {
    const needle = containerQuery.trim().toUpperCase();
    const active = containers.filter((c) => !c.departedAt);
    if (!needle) return active;
    return active.filter((c) => c.id.toUpperCase().includes(needle) || c.typeCode.toUpperCase().includes(needle));
  }, [containers, containerQuery]);

  const handleAddWorker = async (): Promise<void> => {
    if (!draft.name.trim()) return;
    const name = draft.name.trim();
    const { type } = draft;
    try {
      await addWorker(name, type, draft.notes.trim());
      toast.ok('Worker added', `${name} — ${WORKER_TYPE_LABELS[type]}.`);
      setAddOpen(false);
      setDraft(EMPTY_DRAFT);
    } catch {
      toast.error('Could not add worker', 'The server did not save this — try again.');
    }
  };

  const columns = useMemo(
    () => [
      helper.accessor('name', {
        header: 'Name',
        meta: { label: 'Name', lead: true },
        cell: (ctx) => {
          const todayCount = tasksForWorker(containers, ctx.row.original.id).filter((t) => isScheduledFor(t.task, offsetDate(0))).length;
          return (
            <span className="cluster" style={{ gap: 'var(--s-2)' }}>
              <b>{ctx.getValue()}</b>
              {todayCount > 0 && (
                <StatusPill status={{ tone: 'info', icon: 'clock', label: `Today: ${todayCount}`, detail: `${todayCount} task(s) scheduled for today.` }} />
              )}
            </span>
          );
        },
      }),
      helper.accessor('type', {
        header: 'Type',
        meta: { label: 'Type' },
        cell: (ctx) => <CategoryBadge variant="brand">{WORKER_TYPE_LABELS[ctx.getValue()]}</CategoryBadge>,
      }),
      helper.accessor('active', {
        header: 'Status',
        meta: { label: 'Status' },
        cell: (ctx) => (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              toggleWorkerActive(ctx.row.original.id);
            }}
          >
            <StatusPill
              status={
                ctx.getValue()
                  ? { tone: 'ok', icon: 'check-circle', label: 'Active', detail: 'Available for assignment.' }
                  : { tone: 'neutral', icon: 'x-circle', label: 'Inactive', detail: 'Not available for assignment.' }
              }
            />
          </button>
        ),
      }),
      helper.accessor('notes', {
        header: 'Notes',
        meta: { label: 'Notes', secondary: true },
        cell: (ctx) => <span className="subtle">{ctx.getValue() || '—'}</span>,
      }),
      helper.display({
        id: 'assign',
        header: 'Assign',
        meta: { label: 'Assign' },
        cell: (ctx) => (
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setAssignWorkerId(ctx.row.original.id)}>
            Assign work
          </Button>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggleWorkerActive comes from context, stable identity per render is not required here
    [containers]
  );

  const containerColumns = useMemo(
    () => [
      containerHelper.accessor('id', {
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (ctx) => <span className="mono">{ctx.getValue()}</span>,
      }),
      containerHelper.accessor('typeCode', {
        header: 'Type',
        meta: { label: 'Type' },
        cell: (ctx) => <CategoryBadge>{ctx.getValue()}</CategoryBadge>,
      }),
      containerHelper.accessor('size', {
        header: 'Size',
        meta: { label: 'Size', secondary: true },
      }),
      containerHelper.display({
        id: 'status',
        header: 'Status',
        meta: { label: 'Status' },
        cell: (ctx) => <StatusPill status={overallStatus(ctx.row.original)} />,
      }),
      containerHelper.accessor('currentSite', {
        header: 'Site',
        meta: { label: 'Site', secondary: true },
        cell: (ctx) => ctx.getValue() || '—',
      }),
      containerHelper.display({
        id: 'view',
        header: '',
        meta: { label: 'Action' },
        cell: (ctx) => (
          <Button variant="ghost" size="sm" icon="arrow-right" onClick={() => navigate(`/containers/${encodeURIComponent(ctx.row.original.id)}/report`)}>
            View
          </Button>
        ),
      }),
    ],
    [navigate]
  );

  return (
    <div className="stack stack-loose">
      <Segmented
        value={view}
        onChange={setView}
        label="View"
        options={[
          { value: 'workers', label: 'Workers' },
          { value: 'containers', label: 'Containers' },
        ]}
      />

      {view === 'containers' ? (
        <div className="stack stack-loose">
          <InputWithIcon
            icon="search"
            placeholder="Search container number or type…"
            value={containerQuery}
            onChange={(e) => setContainerQuery(e.target.value)}
            style={{ width: '280px' }}
          />
          {containerRows.length === 0 ? (
            <EmptyState icon="package" title="Nothing matches">
              {containers.filter((c) => !c.departedAt).length === 0 ? 'No containers in the yard right now.' : 'Try a different search.'}
            </EmptyState>
          ) : (
            <DataTable
              data={containerRows}
              columns={containerColumns}
              getRowId={(c) => c.id}
              caption="Containers in the yard"
              pageSize={15}
              onRowOpen={(c) => navigate(`/containers/${encodeURIComponent(c.id)}/report`)}
              rowLabel={(c) => `${c.id}, ${c.typeCode}`}
              empty={<EmptyState icon="package" title="Nothing matches">Try a different search.</EmptyState>}
            />
          )}
        </div>
      ) : (
        <>
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <div className="cluster" style={{ gap: 'var(--s-2)' }}>
          <button type="button" className="chip" aria-pressed={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
            All
          </button>
          {WORKER_TYPES.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {WORKER_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="cluster" style={{ gap: 'var(--s-3)' }}>
          <Segmented
            value={displayMode}
            onChange={setDisplayMode}
            label="Display as"
            options={[
              { value: 'cards', label: 'Cards' },
              { value: 'list', label: 'List' },
            ]}
          />
          <Button variant="accent" size="sm" icon="plus" onClick={() => setAddOpen(true)}>
            Add worker
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="user" title="No workers in this view">Try a different type filter, or add one.</EmptyState>
      ) : displayMode === 'list' ? (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(w) => w.id}
          caption="Worker roster"
          pageSize={10}
          onRowOpen={(w) => setOpenId(w.id)}
          rowLabel={(w) => `${w.name}, ${WORKER_TYPE_LABELS[w.type]}`}
          empty={<EmptyState icon="user" title="No workers in this view">Try a different type filter.</EmptyState>}
        />
      ) : (
        // CSS Grid, not multi-column: column-width only adds a new column
        // when there's room for a *full* one, so any leftover sliver of
        // width short of that sits unused at the row's end instead of
        // joining the existing columns — visible, jarring dead space at
        // wider viewports. Grid's 1fr tracks divide the actual available
        // width evenly instead, with no leftover. align-items: start keeps
        // each row's own height independent of the row's tallest card
        // (what the old column layout's own comment was protecting against)
        // — a shorter card simply doesn't stretch to match a taller
        // neighbor, it just leaves blank space below itself within that
        // row, same as before.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--s-4)', alignItems: 'start' }}>
          {rows.map((w) => {
            const todayCount = tasksForWorker(containers, w.id).filter((t) => isScheduledFor(t.task, offsetDate(0))).length;
            return (
              // Not role="button" on the outer div — it wraps several real,
              // independently-interactive buttons (status toggle, Assign
              // work), and giving the wrapper its own button semantics too
              // produces one giant accessible name built from all of that
              // nested content concatenated together. That's not just messy
              // for screen readers: role=button + name "Assign work" then
              // matches *both* the wrapper and the real button, genuinely
              // ambiguous to anything that queries by accessible name — this
              // was caught because it made the real Assign button
              // unreachable by that exact query, not just by eye. The name
              // itself is the one real, scoped, keyboard-focusable trigger
              // for "open detail" instead; the rest of the card's own
              // onClick is a plain mouse convenience on top of that, not a
              // second way to reach the same thing via keyboard — so it's
              // deliberately not given its own role/tabIndex/keyboard handler.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
              <div
                key={w.id}
                className="card hoverable"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setOpenId(w.id)}
              >
                <div className="cluster" style={{ justifyContent: 'space-between' }}>
                  <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                    <button
                      type="button"
                      style={{
                        font: 'inherit',
                        fontWeight: 700,
                        fontSize: '13px',
                        color: 'var(--text)',
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(w.id);
                      }}
                    >
                      {w.name}
                    </button>
                    {todayCount > 0 && (
                      <StatusPill status={{ tone: 'info', icon: 'clock', label: `Today: ${todayCount}`, detail: `${todayCount} task(s) scheduled for today.` }} />
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWorkerActive(w.id);
                    }}
                  >
                    <StatusPill
                      status={
                        w.active
                          ? { tone: 'ok', icon: 'check-circle', label: 'Active', detail: 'Available for assignment.' }
                          : { tone: 'neutral', icon: 'x-circle', label: 'Inactive', detail: 'Not available for assignment.' }
                      }
                    />
                  </button>
                </div>
                <div className="cluster" style={{ gap: 'var(--s-2)', margin: 'var(--s-2) 0 var(--s-3)' }}>
                  <CategoryBadge variant="brand">{WORKER_TYPE_LABELS[w.type]}</CategoryBadge>
                </div>
                {w.notes && (
                  <p className="subtle" style={{ fontSize: '12.5px', margin: '0 0 var(--s-3)' }}>
                    {w.notes}
                  </p>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  icon="plus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssignWorkerId(w.id);
                  }}
                >
                  Assign work
                </Button>
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add worker"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon="plus" onClick={handleAddWorker} disabled={!draft.name.trim()}>
              Add worker
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Name" required>
            {(props) => <input {...props} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Full name" autoComplete="off" />}
          </Field>
          <Field label="Type" required>
            {(props) => (
              <select {...props} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as WorkerType }))}>
                {WORKER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WORKER_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Notes" hint="Optional">
            {(props) => <textarea {...props} rows={2} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="Specialty, shift, anything worth knowing" />}
          </Field>
        </div>
      </Modal>

      <WorkerDetailDrawer
        worker={openWorker}
        containers={containers}
        onOpenChange={(next) => !next && setOpenId(null)}
        onToggleActive={toggleWorkerActive}
        onUpdateWorker={updateWorker}
        onRemoveWorker={removeWorker}
        onAssignWorker={assignWorker}
        onScheduleTask={scheduleTask}
        onUnassignTask={unassignTask}
        onAddTask={addTask}
      />
      <AssignWorkDialog
        open={assignWorkerId !== null}
        onOpenChange={(next) => !next && setAssignWorkerId(null)}
        worker={workers.find((w) => w.id === assignWorkerId) ?? null}
        containers={containers}
        onAssignWorker={assignWorker}
        onScheduleTask={scheduleTask}
        onUnassignTask={unassignTask}
        onAddTask={addTask}
      />
    </div>
  );
}
