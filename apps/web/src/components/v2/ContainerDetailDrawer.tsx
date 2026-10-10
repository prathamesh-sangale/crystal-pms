import { createColumnHelper } from '@tanstack/react-table';
import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  formatElapsed,
  formatSurveyDate,
  GATE_SITE,
  isReadyToMove,
  offsetDate,
  overallStatus,
  paintingTaskBlockedBy,
  RESCHEDULE_OFFSETS,
  SAILING_SITES,
  scheduleLabel,
  SECTION_LABELS,
  SECTION_OWNER_TYPE,
  sectionStatus,
  SIZE_OPTIONS,
  STANDARD_COLORS,
  taskElapsedSec,
  tasksForWorker,
  taskSettled,
  TYPE_CODES,
  WORKER_TYPE_LABELS,
  type GateLogEntry,
  type MockContainer,
  type MockSection,
  type MockTask,
  type MockWorker,
  type SailingSite,
  type SectionKind,
} from '../../lib/mockV2';
import { api } from '../../lib/api';
import { cx } from '../../lib/cx';
import { useLiveTick } from '../../lib/useLiveTick';
import { Button } from '../crystal/Button';
import { StatusPill, Person } from '../crystal/Data';
import { DataTable } from '../crystal/DataTable';
import { EmptyState } from '../crystal/Feedback';
import { Field } from '../crystal/Form';
import { Icon } from '../crystal/Icon';
import { ConfirmDialog, Menu, Modal } from '../crystal/Overlay';
import { GateFormDialog } from './GateFormDialog';
import { MiniStageStrip } from './MiniStageStrip';
import { useStartGuard } from './useStartGuard';

const CUSTOM_COLOR = 'Custom…';
const taskColumnHelper = createColumnHelper<MockTask>();

/** The task table's "Scheduled" cell (the Reschedule menu) — a stable
 * top-level component, not a closure built fresh inside the column list
 * every render, so an open menu survives the drawer's own re-renders (see
 * TaskActionCell below for why that matters). */
function TaskScheduledCell({
  task,
  containerId,
  sectionKind,
  onScheduleTask,
}: {
  task: MockTask;
  containerId: string;
  sectionKind: SectionKind;
  onScheduleTask: (containerId: string, sectionKind: SectionKind, taskKey: string, date: string | null) => void;
}): React.ReactElement {
  // Only a pending, already-assigned task is worth rescheduling — nothing
  // to plan for a task nobody's doing, and a running/settled task's day has
  // already happened.
  if (!task.workerId || task.state !== 'pending') return <span className="subtle">—</span>;
  return (
    <Menu
      label={`Reschedule ${task.label}`}
      trigger={
        <button type="button" className="chip" style={{ fontSize: '11px' }}>
          {scheduleLabel(task.scheduledFor)}
        </button>
      }
      items={RESCHEDULE_OFFSETS.map(({ days, label }) => ({
        label,
        icon: task.scheduledFor === offsetDate(days) ? 'check' : undefined,
        onSelect: () => onScheduleTask(containerId, sectionKind, task.key, offsetDate(days)),
      }))}
    />
  );
}

/** The task table's "Action" cell — a stable top-level component, not an
 * inline closure rebuilt every time the drawer renders. The drawer used to
 * carry its own second-by-second live clock for this cell's elapsed-time
 * readout, which meant the *entire* column list (including this cell's
 * Assign/Site menus) was torn down and rebuilt every tick: `flexRender`
 * treats a cell renderer as a component type, and a fresh inline arrow
 * function is a fresh type each time, so React remounted the whole subtree
 * every second — silently resetting any open Radix menu back to closed.
 * That's what made Assign (and, before it, the now-removed site-move Move
 * menu) appear to open and immediately close on its own.
 *
 * Pulling this out fixes it two ways at once: the cell renderer itself is
 * now a stable reference (its parent only has to build the *wrapper*
 * closure once, memoized — see renderTaskAction below), and this
 * component runs its own `useLiveTick`, scoped to only this one task, so a
 * running timer updates without the rest of the table — or any open menu
 * elsewhere in it — re-rendering at all. */
function TaskActionCell({
  task,
  container,
  section,
  workers,
  containers,
  onStop,
  onCancel,
  onMarkNA,
  onAssignWorker,
  onSetTaskSite,
  attemptStart,
}: {
  task: MockTask;
  container: MockContainer;
  section: MockSection;
  workers: MockWorker[];
  containers: MockContainer[];
  onStop: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  /** Undoes a mistaken Start — back to pending, worker stays assigned. */
  onCancel: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onMarkNA: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onAssignWorker: (containerId: string, sectionKind: SectionKind, taskKey: string, workerId: string) => void;
  onSetTaskSite: (containerId: string, sectionKind: SectionKind, taskKey: string, site: SailingSite) => void;
  attemptStart: (containerId: string, sectionKind: SectionKind, taskKey: string, task: { label: string; workerId: string | null; scheduledFor?: string | null }) => void;
}): React.ReactElement | null {
  const now = useLiveTick(task.state === 'running');
  if (task.state === 'running') {
    return (
      <span className="cluster" style={{ gap: 'var(--s-2)' }}>
        <span className="mono" style={{ fontSize: '12px', color: 'var(--accent)' }}>
          <Icon name="clock" size="sm" /> {formatElapsed(taskElapsedSec(task, now))}
        </span>
        <Button variant="ghost" size="sm" icon="x" onClick={() => onCancel(container.id, section.kind, task.key)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" icon="check-circle" onClick={() => onStop(container.id, section.kind, task.key)}>
          Stop
        </Button>
      </span>
    );
  }
  if (task.state === 'done') {
    return (
      <span className="mono subtle" style={{ fontSize: '12px' }}>
        {formatElapsed(taskElapsedSec(task, now))}
      </span>
    );
  }
  if (task.state === 'na') return <span className="subtle" style={{ fontSize: '12px' }}>N/A</span>;
  if (task.state !== 'pending') return null;
  const hasWorker = Boolean(task.workerId);
  const hasSite = section.kind !== 'all_rounder' || task.site !== null;
  const blockedBy = paintingTaskBlockedBy(section, task);
  const ownerType = task.ownerType ?? SECTION_OWNER_TYPE[section.kind];
  const eligible = workers.filter((w) => w.active && w.type === ownerType);
  return (
    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
      {/* Gated the same as Assign/Start below — skipping an optional step
         early is exactly how a later task could end up reading "clear to
         start" while an earlier one underneath it was still open. */}
      {task.optional && !blockedBy && (
        <Button variant="ghost" size="sm" onClick={() => onMarkNA(container.id, section.kind, task.key)}>
          N/A
        </Button>
      )}
      {blockedBy ? (
        <span className="subtle" style={{ fontSize: '11px' }}>Waiting on {blockedBy.label}</span>
      ) : !hasWorker ? (
        <Menu
          label={`Assign ${WORKER_TYPE_LABELS[ownerType]} to ${task.label}`}
          trigger={
            <Button variant="secondary" size="sm" icon="user">
              Assign
            </Button>
          }
          items={eligible.map((w) => {
            const load = tasksForWorker(containers, w.id);
            const running = load.find((t) => t.task.state === 'running');
            const pendingCount = load.filter((t) => t.task.state === 'pending').length;
            const parts: string[] = [];
            if (running) parts.push(`busy on ${running.containerId}`);
            if (pendingCount > 0) parts.push(`${pendingCount} pending`);
            return {
              label: parts.length ? `${w.name} — ${parts.join(', ')}` : w.name,
              onSelect: () => onAssignWorker(container.id, section.kind, task.key, w.id),
            };
          })}
        />
      ) : section.kind === 'all_rounder' && !task.site ? (
        <Menu
          label={`Pick a site for ${task.label}`}
          trigger={
            <Button variant="secondary" size="sm" icon="pin">
              Site
            </Button>
          }
          items={SAILING_SITES.map((s) => ({
            label: s,
            onSelect: () => onSetTaskSite(container.id, section.kind, task.key, s),
          }))}
        />
      ) : (
        <Button
          variant="secondary"
          size="sm"
          icon="clock"
          disabled={!hasWorker || !hasSite}
          onClick={() => attemptStart(container.id, section.kind, task.key, task)}
        >
          Start
        </Button>
      )}
    </span>
  );
}

export function ContainerDetailDrawer({
  container,
  workers,
  containers,
  onOpenChange,
  onStart,
  onStop,
  onCancel,
  onMarkNA,
  onAssignWorker,
  onScheduleTask,
  onSetTaskSite,
  onMarkReady,
  onUpdateContainer,
  onRemoveContainer,
  onSetPriority,
  onGateOut,
}: {
  container: MockContainer | null;
  workers: MockWorker[];
  /** Every container, not just the open one — so the assign dropdown can
   * warn when a worker is already busy or stacked up elsewhere. */
  containers: MockContainer[];
  onOpenChange: (open: boolean) => void;
  onStart: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onStop: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onCancel: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onMarkNA: (containerId: string, sectionKind: SectionKind, taskKey: string) => void;
  onAssignWorker: (containerId: string, sectionKind: SectionKind, taskKey: string, workerId: string) => void;
  onScheduleTask: (containerId: string, sectionKind: SectionKind, taskKey: string, date: string | null) => void;
  onSetTaskSite: (containerId: string, sectionKind: SectionKind, taskKey: string, site: SailingSite) => void;
  onMarkReady: (containerId: string, photoUrl: string) => Promise<void>;
  onUpdateContainer: (containerId: string, updates: { typeCode: string; size: string; color: string | null }) => void;
  onRemoveContainer: (containerId: string) => Promise<void>;
  onSetPriority: (containerId: string, priority: boolean) => void;
  onGateOut: (containerId: string, entry: GateLogEntry) => Promise<void>;
}): React.ReactElement {
  const navigate = useNavigate();
  // No drawer-wide live tick anymore — TaskActionCell below runs its own,
  // scoped to just the one running task, so the whole table (and any open
  // Assign/Site/Reschedule menu in it) doesn't re-render every second.
  const anyRunning = Boolean(container?.sections.some((s) => s.tasks.some((t) => t.state === 'running')));
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [gateOutOpen, setGateOutOpen] = useState(false);
  const [editDraft, setEditDraft] = useState({ typeCode: TYPE_CODES[0]!, size: SIZE_OPTIONS[0]!, color: STANDARD_COLORS[0]! });
  // Separate from editDraft.color, same split GateFormDialog uses — the
  // select holds either a real STANDARD_COLORS value or the CUSTOM_COLOR
  // sentinel, and the actual free-text value (when the sentinel is picked)
  // lives here, so saving never persists the literal "Custom…" label.
  const [editCustomColor, setEditCustomColor] = useState('');
  // Only one section's tasks are ever on screen at a time — reset to the
  // first section whenever a different container opens, so the tab doesn't
  // carry over a stale selection (e.g. still on "Cleaning" for a Dry unit
  // that has no Cleaning section at all).
  const [activeSectionKind, setActiveSectionKind] = useState<SectionKind | null>(null);
  const { attemptStart, confirmDialog: startConfirmDialog } = useStartGuard(containers, workers, onStart);

  // Hoisted out of the task-table JSX below so renderTaskAction/
  // renderTaskScheduled (both useCallback, which can't live inside that
  // conditionally-rendered block) can depend on it. `.find()` returns a
  // reference to an existing element of container.sections, so this stays
  // referentially stable across renders unless the container's own data
  // actually changes — not just because something elsewhere ticked.
  const activeSection =
    container && container.sections.length > 0
      ? (container.sections.find((s) => s.kind === (activeSectionKind ?? container.sections[0]!.kind)) ?? container.sections[0]!)
      : null;

  const renderTaskScheduled = useCallback(
    (ctx: { row: { original: MockTask } }) => (
      <TaskScheduledCell
        task={ctx.row.original}
        containerId={container?.id ?? ''}
        sectionKind={activeSection?.kind ?? 'painting'}
        onScheduleTask={onScheduleTask}
      />
    ),
    [container, activeSection, onScheduleTask]
  );

  const renderTaskAction = useCallback(
    (ctx: { row: { original: MockTask } }) =>
      container && activeSection ? (
        <TaskActionCell
          task={ctx.row.original}
          container={container}
          section={activeSection}
          workers={workers}
          containers={containers}
          onStop={onStop}
          onCancel={onCancel}
          onMarkNA={onMarkNA}
          onAssignWorker={onAssignWorker}
          onSetTaskSite={onSetTaskSite}
          attemptStart={attemptStart}
        />
      ) : null,
    [container, activeSection, workers, containers, onStop, onCancel, onMarkNA, onAssignWorker, onSetTaskSite, attemptStart]
  );

  useEffect(() => {
    if (editOpen && container) {
      const knownColor = container.color && (STANDARD_COLORS as readonly string[]).includes(container.color);
      setEditDraft({
        typeCode: container.typeCode,
        size: container.size,
        color: !container.color ? STANDARD_COLORS[0]! : knownColor ? container.color : CUSTOM_COLOR,
      });
      setEditCustomColor(knownColor || !container.color ? '' : container.color!);
    }
  }, [editOpen, container]);

  useEffect(() => {
    setActiveSectionKind(container?.sections[0]?.kind ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a different container opening, not every section/task update.
  }, [container?.id]);

  const ready = container ? isReadyToMove(container) : false;
  const status = container ? overallStatus(container) : null;
  const editIsReefer = editDraft.typeCode.startsWith('Reefer');

  // A completion photo is required before "Mark ready to move" actually
  // does anything (client request) -- uploading it and marking ready happen
  // together, in the one action below, so readyAt is never set without one.
  const [readyPhotoUploading, setReadyPhotoUploading] = useState(false);
  const [readyPhotoError, setReadyPhotoError] = useState<string | null>(null);
  const readyPhotoInputId = useId();

  const handleReadyPhoto = async (file: File | null): Promise<void> => {
    if (!file || !container) return;
    setReadyPhotoError(null);
    setReadyPhotoUploading(true);
    try {
      const { url } = await api.v2Upload(file);
      await onMarkReady(container.id, url);
    } catch {
      setReadyPhotoError('Could not upload that photo. Try again.');
    } finally {
      setReadyPhotoUploading(false);
    }
  };

  const handleSaveEdit = (): void => {
    if (!container) return;
    onUpdateContainer(container.id, {
      typeCode: editDraft.typeCode,
      size: editDraft.size,
      color: editIsReefer ? 'White' : editDraft.color === CUSTOM_COLOR ? editCustomColor.trim() || 'Unspecified' : editDraft.color,
    });
    setEditOpen(false);
  };

  const handleDelete = (): void => {
    if (!container) return;
    onRemoveContainer(container.id);
    setDeleteOpen(false);
    onOpenChange(false);
  };

  return (
    <Modal
      open={Boolean(container)}
      onOpenChange={onOpenChange}
      size="lg"
      title={<span className="mono">{container?.id}</span>}
      subtitle={
        container && (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <span className="subtle" style={{ fontSize: '11px' }}>
              {container.typeCode} · {container.size} · At {container.currentSite ?? GATE_SITE}
              {container.color && ` · ${container.color}`}
            </span>
            {container.priority && (
              <StatusPill status={{ tone: 'bad', icon: 'alert', label: 'Fast-track', detail: 'Flagged to handle ahead of normal work.' }} />
            )}
            {status && <StatusPill status={status} />}
            <MiniStageStrip container={container} />
          </span>
        )
      }
      headerActions={
        container && (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            {/* Fast-tracking only means something while there's still a queue to
               jump — once everything's done and the container is cleared to
               move, there's nothing left to prioritize. */}
            {!container.readyAt && (
              <Button
                variant={container.priority ? 'accent' : 'ghost'}
                size="sm"
                icon="alert"
                onClick={() => onSetPriority(container.id, !container.priority)}
              >
                {container.priority ? 'Remove from fast-track' : 'Fast-track'}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditOpen(true)} disabled={Boolean(container.departedAt)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteOpen(true)} disabled={anyRunning || Boolean(container.departedAt)}>
              Delete
            </Button>
          </span>
        )
      }
      footer={
        !container ? null : container.departedAt ? (
          <span className="cluster" style={{ marginLeft: 'auto' }}>
            <StatusPill status={{ tone: 'neutral', icon: 'truck', label: 'Departed', detail: `Gated out ${formatSurveyDate(container.departedAt)}.` }} />
            <Button variant="primary" icon="download" onClick={() => navigate(`/containers/${encodeURIComponent(container.id)}/report`)}>
              Get report
            </Button>
          </span>
        ) : container.readyAt ? (
          <span className="cluster" style={{ marginLeft: 'auto' }}>
            <StatusPill status={{ tone: 'ok', icon: 'check-circle', label: 'Ready to move', detail: 'Cleared for release.' }} />
            <Button variant="secondary" icon="truck" onClick={() => setGateOutOpen(true)}>
              Gate out
            </Button>
            <Button variant="primary" icon="download" onClick={() => navigate(`/containers/${encodeURIComponent(container.id)}/report`)}>
              Get report
            </Button>
          </span>
        ) : ready ? (
          <span className="cluster" style={{ marginLeft: 'auto', gap: 'var(--s-2)', alignItems: 'center' }}>
            {readyPhotoError && (
              <span className="subtle" style={{ color: 'var(--text-bad, #b42318)', fontSize: '12px' }}>
                {readyPhotoError}
              </span>
            )}
            <label
              htmlFor={readyPhotoInputId}
              className={cx('btn', 'btn-primary', readyPhotoUploading && 'loading')}
              aria-disabled={readyPhotoUploading}
            >
              <Icon name="upload" size="sm" />
              Upload completion photo to mark ready
            </label>
            <input
              id={readyPhotoInputId}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={readyPhotoUploading}
              onChange={(e) => {
                void handleReadyPhoto(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </span>
        ) : (
          <Button variant="primary" icon="check-circle" style={{ marginLeft: 'auto' }} disabled>
            Mark ready to move
          </Button>
        )
      }
    >
      {!container ? null : (
      <div className="stack stack-loose">
        {!container.survey && (
          <div className="empty" style={{ padding: 'var(--s-5) 0' }}>
            <Icon name="doc" size="lg" />
            <b>Awaiting survey</b>
            <p>This unit hasn&rsquo;t been surveyed yet — run the survey to gate it in.</p>
          </div>
        )}

        {container.survey && (
          <p className="subtle" style={{ fontSize: '11.5px', margin: 0 }}>
            Survey ({formatSurveyDate(container.survey.performedAt)}): {container.survey.outcome === 'ready' ? 'No issues found' : 'Repair / prep required'}
            {container.sections.length > 0 && ` · ${container.sections.length} section${container.sections.length === 1 ? '' : 's'} flagged`}
          </p>
        )}

        {container.sections.length > 0 && (() => {
          const activeKind = activeSectionKind ?? container.sections[0]!.kind;
          const section = container.sections.find((s) => s.kind === activeKind) ?? container.sections[0]!;

          const taskColumns = [
            taskColumnHelper.accessor('label', {
              header: 'Task',
              meta: { label: 'Task', lead: true },
              cell: (ctx) => {
                const task = ctx.row.original;
                return (
                  <span style={{ fontWeight: 600, textDecoration: task.state === 'na' ? 'line-through' : 'none', color: task.state === 'na' ? 'var(--text-3)' : 'var(--text)' }}>
                    {ctx.getValue()}
                  </span>
                );
              },
            }),
            taskColumnHelper.display({
              id: 'worker',
              header: 'Worker',
              meta: { label: 'Worker' },
              cell: (ctx) => {
                const task = ctx.row.original;
                const worker = workers.find((w) => w.id === task.workerId);
                if (worker && task.state !== 'na') return <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} />;
                return <span className="subtle">{task.state === 'pending' ? 'Unassigned' : '—'}</span>;
              },
            }),
            taskColumnHelper.display({
              id: 'scheduled',
              header: 'Scheduled',
              // Not `secondary` like Time — this is the one place to see or
              // change which day a task is planned for, so it stays visible
              // even where a secondary column would drop (see app.css's
              // `.modal [data-secondary]` rule).
              meta: { label: 'Scheduled' },
              cell: renderTaskScheduled,
            }),
            taskColumnHelper.display({
              id: 'action',
              header: 'Action',
              meta: { label: 'Action' },
              cell: renderTaskAction,
            }),
          ];

          return (
            <div className="stagework">
              {/* One section's work at a time — the rail says where you are
                 and what's done, the pane on the right is all there is to
                 look at for whichever one you picked. */}
              <div className="stagerail" role="tablist" aria-label="Section">
                {container.sections.map((s) => {
                  const status = sectionStatus(s);
                  const on = s.kind === activeKind;
                  return (
                    <button
                      key={s.kind}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      className={cx('stagerail-item', status.tone, on && 'on')}
                      onClick={() => setActiveSectionKind(s.kind)}
                    >
                      <span className="stagerail-dot">
                        <Icon name={status.tone === 'ok' ? 'check' : 'clock'} size="sm" />
                      </span>
                      <span className="stagerail-label">
                        {SECTION_LABELS[s.kind]}
                        <span className="stagerail-count">{s.tasks.filter(taskSettled).length}/{s.tasks.length}</span>
                      </span>
                      {status.tone === 'info' && <span className="stagerail-live">LIVE</span>}
                    </button>
                  );
                })}
              </div>
              <div className="stagework-panel">
                <div className="cluster" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-3)' }}>
                  <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '13px' }}>
                    {SECTION_LABELS[section.kind]}
                    {section.kind === 'painting' && container.color && (
                      <span className="subtle" style={{ fontWeight: 400, fontSize: '11.5px' }}> · {container.color}</span>
                    )}
                  </span>
                  <StatusPill status={sectionStatus(section)} />
                </div>
                <DataTable
                  data={section.tasks}
                  columns={taskColumns}
                  getRowId={(t) => t.key}
                  caption={`${SECTION_LABELS[section.kind]} tasks`}
                  pageSize={20}
                  empty={
                    <EmptyState icon="check-circle" title="Nothing here">
                      No tasks in this section.
                    </EmptyState>
                  }
                />
              </div>
            </div>
          );
        })()}

      </div>
      )}

      <Modal
        open={editOpen}
        onOpenChange={setEditOpen}
        title="Edit container"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={handleSaveEdit}>
              Save
            </Button>
          </>
        }
      >
        <div className="stack">
          <Field label="Type / product code">
            {(props) => (
              <select
                {...props}
                value={editDraft.typeCode}
                onChange={(e) => setEditDraft((d) => ({ ...d, typeCode: e.target.value }))}
              >
                {TYPE_CODES.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
          </Field>
          <Field label="Size">
            {(props) => (
              <select {...props} value={editDraft.size} onChange={(e) => setEditDraft((d) => ({ ...d, size: e.target.value }))}>
                {SIZE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </Field>
          {editIsReefer ? (
            <Field label="Paint colour" hint="Reefers default to white">
              {(props) => <input {...props} value="White" disabled />}
            </Field>
          ) : (
            <>
              <Field label="Paint colour">
                {(props) => (
                  <select {...props} value={editDraft.color} onChange={(e) => setEditDraft((d) => ({ ...d, color: e.target.value }))}>
                    {[...STANDARD_COLORS, CUSTOM_COLOR].map((c) => <option key={c}>{c}</option>)}
                  </select>
                )}
              </Field>
              {editDraft.color === CUSTOM_COLOR && (
                <Field label="Custom colour">
                  {(props) => <input {...props} value={editCustomColor} onChange={(e) => setEditCustomColor(e.target.value)} placeholder="e.g. Traffic Red" />}
                </Field>
              )}
            </>
          )}
        </div>
      </Modal>

      {container && (
        <GateFormDialog
          mode="out"
          open={gateOutOpen}
          onOpenChange={setGateOutOpen}
          container={container}
          onGateOut={onGateOut}
        />
      )}

      {container && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete container"
          body={
            <>
              Remove <b className="mono">{container.id}</b> from the yard? Its survey, task history, and movement log all go with it. This
              can’t be undone.
            </>
          }
          confirmLabel={`Delete ${container.id}`}
          destructive
          onConfirm={handleDelete}
        />
      )}

      {startConfirmDialog}
    </Modal>
  );
}
