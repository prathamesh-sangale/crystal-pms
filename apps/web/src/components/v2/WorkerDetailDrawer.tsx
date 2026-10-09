import { useEffect, useState } from 'react';
import {
  formatElapsed,
  isScheduledFor,
  offsetDate,
  SECTION_LABELS,
  taskElapsedSec,
  WORKER_TYPE_LABELS,
  WORKER_TYPES,
  type LiveTask,
  type MockContainer,
  type MockWorker,
  type SectionKind,
  type WorkerType,
} from '../../lib/mockV2';
import { useLiveTick } from '../../lib/useLiveTick';
import { AssignWorkDialog } from './AssignWorkDialog';
import { Button, Segmented } from '../crystal/Button';
import { DataPanel, StatusPill } from '../crystal/Data';
import { useToast } from '../crystal/Feedback';
import { Field, SwitchField } from '../crystal/Form';
import { Icon } from '../crystal/Icon';
import { ConfirmDialog, Modal } from '../crystal/Overlay';

/** How many completed tasks show before the rest collapse to a count —
 * keeps the modal a fixed, non-scrolling size no matter how long a worker's
 * history gets. */
const COMPLETED_SHOWN = 4;

type HoursWindow = 'week' | 'month' | 'all';
const WINDOW_DAYS: Record<Exclude<HoursWindow, 'all'>, number> = { week: 7, month: 30 };

const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: '10px',
  letterSpacing: '0.8px',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 'var(--s-1)',
};

function CompactTaskRow({ row, now }: { row: LiveTask; now: number }): React.ReactElement {
  const elapsed = taskElapsedSec(row.task, now);
  return (
    <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="truncate" style={{ fontSize: '12px', minWidth: 0 }}>
        <b>{row.task.label}</b>{' '}
        <span className="subtle">
          <span className="mono">{row.containerId}</span> · {SECTION_LABELS[row.section]}
        </span>
      </span>
      <span
        className="mono"
        style={{ fontSize: '11px', flexShrink: 0, color: row.task.state === 'running' ? 'var(--accent)' : 'var(--text-3)' }}
      >
        {row.task.state === 'running' && <Icon name="clock" size="sm" />}
        {row.task.state === 'pending' ? 'Not started' : formatElapsed(elapsed)}
      </span>
    </div>
  );
}

export function WorkerDetailDrawer({
  worker,
  containers,
  onOpenChange,
  onToggleActive,
  onUpdateWorker,
  onRemoveWorker,
  onAssignWorker,
  onScheduleTask,
  onUnassignTask,
}: {
  worker: MockWorker | null;
  containers: MockContainer[];
  onOpenChange: (open: boolean) => void;
  onToggleActive: (workerId: string) => void;
  onUpdateWorker: (workerId: string, updates: { name: string; type: WorkerType; notes: string }) => void;
  onRemoveWorker: (workerId: string) => void;
  onAssignWorker: (containerId: string, kind: SectionKind, key: string, workerId: string) => void;
  onScheduleTask: (containerId: string, kind: SectionKind, key: string, date: string | null) => void;
  onUnassignTask: (containerId: string, kind: SectionKind, key: string) => void;
}): React.ReactElement {
  const tasks: LiveTask[] = worker
    ? containers.flatMap((c) => c.sections.flatMap((s) => s.tasks.filter((t) => t.workerId === worker.id).map((task) => ({ containerId: c.id, containerTypeCode: c.typeCode, section: s.kind, task }))))
    : [];
  const running = tasks.filter((t) => t.task.state === 'running');
  const pending = tasks.filter((t) => t.task.state === 'pending');
  const done = tasks.filter((t) => t.task.state === 'done');
  const scheduledTodayCount = tasks.filter((t) => isScheduledFor(t.task, offsetDate(0))).length;
  const now = useLiveTick(running.length > 0);
  const toast = useToast();
  const [assignOpen, setAssignOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'painter' as WorkerType, notes: '' });
  const [hoursWindow, setHoursWindow] = useState<HoursWindow>('all');

  // Actual worked time (elapsedSec), not the estHrs guess. Tasks completed
  // before `completedAt` existed only ever count toward "All time" — there's
  // no real date to bucket them into a week or month.
  const hoursInWindow = (window: HoursWindow): number => {
    const relevant =
      window === 'all'
        ? done
        : done.filter((t) => t.task.completedAt && Date.now() - new Date(t.task.completedAt).getTime() <= WINDOW_DAYS[window] * 24 * 3600 * 1000);
    return Math.round((relevant.reduce((sum, t) => sum + t.task.elapsedSec, 0) / 3600) * 10) / 10;
  };
  const windowHrs = hoursInWindow(hoursWindow);

  useEffect(() => {
    if (editOpen && worker) setDraft({ name: worker.name, type: worker.type, notes: worker.notes });
  }, [editOpen, worker]);

  const handleSaveEdit = (): void => {
    if (!worker || !draft.name.trim()) return;
    onUpdateWorker(worker.id, { name: draft.name.trim(), type: draft.type, notes: draft.notes.trim() });
    toast.ok('Worker updated', `${draft.name.trim()} — ${WORKER_TYPE_LABELS[draft.type]}.`);
    setEditOpen(false);
  };

  const handleDelete = (): void => {
    if (!worker) return;
    const name = worker.name;
    onRemoveWorker(worker.id);
    toast.ok('Worker removed', `${name} is off the roster.`);
    setDeleteOpen(false);
  };

  return (
    <Modal
      open={Boolean(worker)}
      onOpenChange={onOpenChange}
      title={worker?.name ?? ''}
      subtitle={
        worker && (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <span className="subtle mono" style={{ fontSize: '11px' }}>{WORKER_TYPE_LABELS[worker.type]}</span>
            <StatusPill
              status={
                worker.active
                  ? { tone: 'ok', icon: 'check-circle', label: 'Active', detail: 'Available for assignment.' }
                  : { tone: 'neutral', icon: 'x-circle', label: 'Inactive', detail: 'Not available for assignment.' }
              }
            />
            {scheduledTodayCount > 0 && (
              <StatusPill
                status={{
                  tone: 'info',
                  icon: 'clock',
                  label: `Today: ${scheduledTodayCount}`,
                  detail: `${scheduledTodayCount} task(s) scheduled for today.`,
                }}
              />
            )}
          </span>
        )
      }
      headerActions={
        worker && (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setAssignOpen(true)}>
              Assign work
            </Button>
            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteOpen(true)} disabled={running.length > 0}>
              Delete
            </Button>
          </span>
        )
      }
      size="lg"
    >
      {!worker ? null : (
        <div className="workerdetail-grid">
          <DataPanel title="Record">
            <div className="infogrid">
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Type</dt>
                <dd>{WORKER_TYPE_LABELS[worker.type]}</dd>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Notes</dt>
                <dd>{worker.notes || '—'}</dd>
              </div>
              <div>
                <dt>Running</dt>
                <dd>{running.length}</dd>
              </div>
              <div>
                <dt>Assigned</dt>
                <dd>{pending.length}</dd>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Completed</dt>
                <dd>{done.length}</dd>
              </div>
            </div>

            <div className="cluster" style={{ justifyContent: 'space-between', marginTop: 'var(--s-3)' }}>
              <span style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--text-2)' }}>Hours worked</span>
              <Segmented
                value={hoursWindow}
                onChange={setHoursWindow}
                label="Hours window"
                options={[
                  { value: 'week', label: 'Week' },
                  { value: 'month', label: 'Month' },
                  { value: 'all', label: 'All time' },
                ]}
              />
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: '22px', color: 'var(--text)', margin: '4px 0 0' }}>
              {windowHrs ? `~${windowHrs}h` : '—'}
            </div>

            <div className="cluster" style={{ marginTop: 'var(--s-3)' }}>
              <SwitchField checked={worker.active} onCheckedChange={() => onToggleActive(worker.id)} label="Available for assignment" />
            </div>
            {running.length > 0 && (
              <p className="subtle" style={{ fontSize: '11px', margin: 'var(--s-2) 0 0' }}>
                Stop {worker.name.split(' ')[0]}&rsquo;s running task to remove them.
              </p>
            )}
          </DataPanel>

          <div className="stack stack-loose">
            {running.length + pending.length + done.length === 0 ? (
              <div className="empty" style={{ padding: 'var(--s-4) 0' }}>
                <Icon name="user" size="lg" />
                <b>No work assigned yet</b>
                <p>Assign {worker.name.split(' ')[0]} to a task from any container&rsquo;s section.</p>
              </div>
            ) : (
              <>
                {running.length > 0 && (
                  <div>
                    <div style={SECTION_LABEL_STYLE}>Running now · {running.length}</div>
                    {running.map((row) => (
                      <CompactTaskRow key={`${row.containerId}-${row.task.key}`} row={row} now={now} />
                    ))}
                  </div>
                )}
                {pending.length > 0 && (
                  <div>
                    <div style={SECTION_LABEL_STYLE}>Assigned, not started · {pending.length}</div>
                    {pending.map((row) => (
                      <CompactTaskRow key={`${row.containerId}-${row.task.key}`} row={row} now={now} />
                    ))}
                  </div>
                )}
                {done.length > 0 && (
                  <div>
                    <div style={SECTION_LABEL_STYLE}>Completed · {done.length}</div>
                    {done.slice(0, COMPLETED_SHOWN).map((row) => (
                      <CompactTaskRow key={`${row.containerId}-${row.task.key}`} row={row} now={now} />
                    ))}
                    {done.length > COMPLETED_SHOWN && (
                      <p className="subtle" style={{ fontSize: '11px', margin: 'var(--s-1) 0 0' }}>
                        +{done.length - COMPLETED_SHOWN} more completed
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit worker"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={handleSaveEdit} disabled={!draft.name.trim()}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Name" required>
            {(props) => <input {...props} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoComplete="off" />}
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
            {(props) => <textarea {...props} rows={2} value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} />}
          </Field>
        </div>
      </Modal>

      {worker && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete worker"
          body={
            <>
              Remove <b>{worker.name}</b> from the roster?
              {pending.length > 0
                ? ` Their ${pending.length} unstarted task${pending.length === 1 ? '' : 's'} will go back to unassigned.`
                : ' This can’t be undone.'}
            </>
          }
          confirmLabel={`Delete ${worker.name}`}
          destructive
          onConfirm={handleDelete}
        />
      )}

      <AssignWorkDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        worker={worker}
        containers={containers}
        onAssignWorker={onAssignWorker}
        onScheduleTask={onScheduleTask}
        onUnassignTask={onUnassignTask}
      />
    </Modal>
  );
}
