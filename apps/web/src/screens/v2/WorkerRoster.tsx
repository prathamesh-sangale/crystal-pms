import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { isScheduledFor, offsetDate, tasksForWorker, WORKER_TYPE_LABELS, WORKER_TYPES, type MockWorker, type WorkerType } from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { AssignWorkDialog } from '../../components/v2/AssignWorkDialog';
import { WorkerDetailDrawer } from '../../components/v2/WorkerDetailDrawer';
import { Button, Segmented } from '../../components/crystal/Button';
import { CategoryBadge, StatusPill } from '../../components/crystal/Data';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { Field } from '../../components/crystal/Form';
import { Modal } from '../../components/crystal/Overlay';

const helper = createColumnHelper<MockWorker>();

const EMPTY_DRAFT = { name: '', type: 'painter' as WorkerType, notes: '' };
type DisplayMode = 'cards' | 'list';

export function WorkerRoster(): React.ReactElement {
  const { workers, containers, addWorker, updateWorker, removeWorker, toggleWorkerActive, assignWorker, scheduleTask, unassignTask } = useV2Data();
  const [typeFilter, setTypeFilter] = useState<WorkerType | 'all'>('all');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [openId, setOpenId] = useState<string | null>(null);
  // Assigning directly from a roster row — no need to open the full profile
  // drawer first, same as the crew table on Live Board.
  const [assignWorkerId, setAssignWorkerId] = useState<string | null>(null);
  const toast = useToast();

  const rows = useMemo(() => (typeFilter === 'all' ? workers : workers.filter((w) => w.type === typeFilter)), [workers, typeFilter]);
  const openWorker = workers.find((w) => w.id === openId) ?? null;

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

  return (
    <div className="stack stack-loose">
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
        // CSS multi-column, not CSS Grid: a grid row's height is set by its
        // tallest cell, so a worker card with no notes still gets stretched
        // or left floating above bare space next to a taller one. Columns
        // pack each card tight to its own content instead.
        <div style={{ columnWidth: '260px', columnGap: 'var(--s-4)' }}>
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
                style={{ textAlign: 'left', cursor: 'pointer', breakInside: 'avoid', marginBottom: 'var(--s-4)' }}
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
      />
      <AssignWorkDialog
        open={assignWorkerId !== null}
        onOpenChange={(next) => !next && setAssignWorkerId(null)}
        worker={workers.find((w) => w.id === assignWorkerId) ?? null}
        containers={containers}
        onAssignWorker={assignWorker}
        onScheduleTask={scheduleTask}
        onUnassignTask={unassignTask}
      />
    </div>
  );
}
