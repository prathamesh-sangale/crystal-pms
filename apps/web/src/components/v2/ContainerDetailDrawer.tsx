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
  RESCHEDULE_OFFSETS,
  SAILING_SITES,
  scheduleLabel,
  SECTION_LABELS,
  SECTION_OWNER_TYPE,
  sectionStatus,
  taskElapsedSec,
  tasksForWorker,
  taskSettled,
  tntStatusForTask,
  WORKER_TYPE_LABELS,
  type GateLogEntry,
  type MockContainer,
  type MockSection,
  type MockSurveyField,
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
import { EmptyState, useToast } from '../crystal/Feedback';
import { Icon } from '../crystal/Icon';
import { ConfirmDialog, Menu, Modal } from '../crystal/Overlay';
import { GateFormDialog } from './GateFormDialog';
import { MiniStageStrip } from './MiniStageStrip';
import { gateLogPhotoEntries, PhotoThumb } from './PhotoThumb';
import { RunSurveyDialog, type SurveyDraftData } from './RunSurveyDialog';
import { useStartGuard } from './useStartGuard';

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
  // Any active worker can be assigned to any task now, regardless of
  // designation — ownerType is kept only as a label for the Assign menu's
  // title (what this task was originally meant for), not an eligibility
  // filter.
  const ownerType = task.ownerType ?? SECTION_OWNER_TYPE[section.kind];
  const eligible = workers.filter((w) => w.active);
  return (
    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
      {task.optional && (
        <Button variant="ghost" size="sm" onClick={() => onMarkNA(container.id, section.kind, task.key)}>
          N/A
        </Button>
      )}
      {!hasWorker ? (
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

/** The task's own actual worked time — distinct from TAT (the turnaround
 * target/elapsed, which never factors in whether anyone's actually working
 * it). Pulled out the same way `TaskActionCell` above is: its own scoped
 * `useLiveTick`, so a running task's clock updates without re-rendering the
 * rest of the table. */
function TaskTimeCell({ task }: { task: MockTask }): React.ReactElement {
  const now = useLiveTick(task.state === 'running');
  return (
    <span className="mono" style={{ fontSize: '12px', color: task.state === 'running' ? 'var(--accent)' : 'var(--text-3)' }}>
      {task.state === 'running' && <Icon name="clock" size="sm" />} {formatElapsed(taskElapsedSec(task, now))}
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
  onRemoveContainer,
  onRunSurvey,
  surveyDraft,
  onSaveSurveyDraft,
  onDiscardSurveyDraft,
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
  onMarkReady: (containerId: string, photoUrls: string[]) => Promise<void>;
  /** Absent on Live Board's own instance of this drawer, by direct design
   * decision — removing a container outright is Yard Board's alone now, not
   * something available from wherever a container happens to be opened
   * from. The server enforces the same split
   * (apps/api/src/routes/v2Containers.ts), so this isn't just cosmetic. */
  onRemoveContainer?: (containerId: string) => Promise<void>;
  /** Same Yard-only split as onRemoveContainer above — retrofitting a
   * survey onto a container that skipped one is a Yard Board action, not
   * something Live Board's drawer offers. */
  onRunSurvey?: (containerId: string, result: { outcome: 'ready' | 'needs-work'; fields: MockSurveyField[]; sections: Array<{ kind: SectionKind; tasks: MockTask[] }> }) => Promise<void>;
  /** This container's own in-progress survey draft, if any — found by the
   * caller against the shared drafts list, same Yard-only availability as
   * onRunSurvey itself. */
  surveyDraft?: { id: string; data: SurveyDraftData } | null;
  onSaveSurveyDraft?: (containerId: string, data: SurveyDraftData) => Promise<void>;
  onDiscardSurveyDraft?: (draftId: string) => Promise<void>;
  onSetPriority: (containerId: string, priority: boolean) => void;
  onGateOut: (containerId: string, entry: GateLogEntry) => Promise<void>;
}): React.ReactElement {
  const navigate = useNavigate();
  // No drawer-wide live tick anymore — TaskActionCell below runs its own,
  // scoped to just the one running task, so the whole table (and any open
  // Assign/Site/Reschedule menu in it) doesn't re-render every second.
  const anyRunning = Boolean(container?.sections.some((s) => s.tasks.some((t) => t.state === 'running')));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [gateOutOpen, setGateOutOpen] = useState(false);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [photosOpen, setPhotosOpen] = useState(false);
  const toast = useToast();
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
    setActiveSectionKind(container?.sections[0]?.kind ?? null);
    setReadyPhotos([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a different container opening, not every section/task update.
  }, [container?.id]);

  const ready = container ? isReadyToMove(container) : false;
  const status = container ? overallStatus(container) : null;

  // At least one completion photo is required before "Mark ready to move"
  // actually does anything (client request) -- photos are uploaded (one
  // Drive call per file, camera or gallery, any number of times) and staged
  // here first, so they can be reviewed/removed before the single action
  // below sets readyAt together with all of them at once.
  const [readyPhotos, setReadyPhotos] = useState<string[]>([]);
  const [readyPhotoUploading, setReadyPhotoUploading] = useState(false);
  const [readyPhotoError, setReadyPhotoError] = useState<string | null>(null);
  const [markReadyBusy, setMarkReadyBusy] = useState(false);
  const readyCameraInputId = useId();
  const readyGalleryInputId = useId();

  const handleReadyPhotos = async (files: File[]): Promise<void> => {
    if (files.length === 0 || !container) return;
    setReadyPhotoError(null);
    setReadyPhotoUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files) {
        const { url } = await api.v2Upload(file, 'survey');
        uploaded.push(url);
      }
      setReadyPhotos((cur) => [...cur, ...uploaded]);
    } catch (err) {
      console.error('Ready-photo upload failed:', err);
      setReadyPhotoError(err instanceof Error ? err.message : 'Could not upload that photo. Try again.');
    } finally {
      setReadyPhotoUploading(false);
    }
  };

  const removeReadyPhoto = (url: string): void => {
    setReadyPhotos((cur) => cur.filter((u) => u !== url));
  };

  const handleMarkReady = async (): Promise<void> => {
    if (!container || readyPhotos.length === 0) return;
    setReadyPhotoError(null);
    setMarkReadyBusy(true);
    try {
      await onMarkReady(container.id, readyPhotos);
    } catch {
      setReadyPhotoError('Could not mark ready. Try again.');
    } finally {
      setMarkReadyBusy(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!container || !onRemoveContainer) return;
    setDeleteBusy(true);
    try {
      await onRemoveContainer(container.id);
      setDeleteOpen(false);
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not delete this container', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(container)}
      onOpenChange={onOpenChange}
      size="xl"
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
            {/* Direct request: once a photo's uploaded (Gate In, Gate Out, or
               the ready-to-move completion photo) there was no way to look
               at it again short of the full printed report. Available any
               time any of the three actually has photos, regardless of the
               container's current state. */}
            {Boolean(container.gateIn || container.gateOut || container.readyPhotoUrls.length > 0) && (
              <Button variant="ghost" size="sm" icon="gallery" onClick={() => setPhotosOpen(true)}>
                Photos
              </Button>
            )}
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
            {/* Repeatable now, direct request: an admin can flag more work
               on a container any time, even one that's already ready,
               already surveyed, or already mid-work -- only gated on not
               having left the yard yet. The server (v2Containers.ts) is
               additive on a re-run, not a one-shot gate anymore: a section
               that already exists only gets genuinely new tasks, nothing
               duplicated. */}
            {onRunSurvey && !container.departedAt && (
              <Button variant="ghost" size="sm" icon="doc" onClick={() => setSurveyOpen(true)}>
                {container.survey ? 'Run survey again' : 'Run survey'}
              </Button>
            )}
            {onRemoveContainer && (
              <Button variant="ghost" size="sm" icon="trash" onClick={() => setDeleteOpen(true)} disabled={anyRunning || Boolean(container.departedAt)}>
                Delete
              </Button>
            )}
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
          <span className="stack" style={{ marginLeft: 'auto', alignItems: 'flex-end', gap: 'var(--s-2)' }}>
            {readyPhotoError && (
              <span className="subtle" style={{ color: 'var(--text-bad, #b42318)', fontSize: '12px' }}>
                {readyPhotoError}
              </span>
            )}
            {readyPhotos.length > 0 && (
              <span className="cluster" style={{ gap: 'var(--s-1)' }}>
                {readyPhotos.map((url) => (
                  <span key={url} style={{ position: 'relative' }}>
                    <img
                      src={url}
                      alt=""
                      style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}
                    />
                    <button
                      type="button"
                      className="iconbtn bare"
                      aria-label="Remove this photo"
                      onClick={() => removeReadyPhoto(url)}
                      style={{ position: 'absolute', top: '-6px', right: '-6px', background: 'var(--scrim)', color: 'var(--text-inv)' }}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </span>
                ))}
              </span>
            )}
            <span className="cluster" style={{ gap: 'var(--s-2)' }}>
              <label
                htmlFor={readyCameraInputId}
                className={cx('btn', 'btn-secondary', 'btn-sm', readyPhotoUploading && 'loading')}
                aria-disabled={readyPhotoUploading}
              >
                <Icon name="camera" size="sm" />
                Camera
              </label>
              <input
                id={readyCameraInputId}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                disabled={readyPhotoUploading}
                onChange={(e) => {
                  void handleReadyPhotos([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <label
                htmlFor={readyGalleryInputId}
                className={cx('btn', 'btn-secondary', 'btn-sm', readyPhotoUploading && 'loading')}
                aria-disabled={readyPhotoUploading}
              >
                <Icon name="gallery" size="sm" />
                Gallery
              </label>
              <input
                id={readyGalleryInputId}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                disabled={readyPhotoUploading}
                onChange={(e) => {
                  void handleReadyPhotos([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <Button
                variant="primary"
                icon="check-circle"
                loading={markReadyBusy}
                disabled={readyPhotos.length === 0 || readyPhotoUploading || markReadyBusy}
                onClick={() => void handleMarkReady()}
              >
                Mark ready to move
              </Button>
            </span>
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
              id: 'tat',
              header: 'TAT',
              meta: { label: 'TAT' },
              cell: (ctx) => {
                const tnt = tntStatusForTask(section, ctx.row.original);
                return tnt ? <StatusPill status={tnt} /> : <span className="subtle">—</span>;
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
              id: 'time',
              header: 'Time',
              // Secondary (drops out of the modal's narrower layout first) --
              // the task's own actual worked time, separate from TAT above.
              meta: { label: 'Time', secondary: true },
              cell: (ctx) => <TaskTimeCell task={ctx.row.original} />,
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

      {container && (
        <GateFormDialog
          mode="out"
          open={gateOutOpen}
          onOpenChange={setGateOutOpen}
          container={container}
          onGateOut={onGateOut}
        />
      )}

      {container && onRunSurvey && (
        <RunSurveyDialog
          open={surveyOpen}
          onOpenChange={setSurveyOpen}
          container={container}
          draft={surveyDraft}
          onRunSurvey={onRunSurvey}
          onSaveDraft={async (containerId, data) => onSaveSurveyDraft?.(containerId, data)}
          onDiscardDraft={async (draftId) => onDiscardSurveyDraft?.(draftId)}
        />
      )}

      {container && (
        <Modal open={photosOpen} onOpenChange={setPhotosOpen} title="Photos" subtitle={<span className="mono">{container.id}</span>} size="lg">
          <div className="stack stack-loose">
            {container.gateIn && (
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
                  Gate In
                </div>
                {gateLogPhotoEntries(container.gateIn).length > 0 ? (
                  <div className="photo-grid">
                    {gateLogPhotoEntries(container.gateIn).map((p) => (
                      <figure key={p.label} style={{ margin: 0 }}>
                        <PhotoThumb url={p.url} label={p.label} />
                        <figcaption className="subtle" style={{ fontSize: '10.5px', marginTop: '4px' }}>{p.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="subtle" style={{ fontSize: '12.5px', margin: 0 }}>No photos on this record.</p>
                )}
              </div>
            )}

            {container.gateOut && (
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
                  Gate Out
                </div>
                {gateLogPhotoEntries(container.gateOut).length > 0 ? (
                  <div className="photo-grid">
                    {gateLogPhotoEntries(container.gateOut).map((p) => (
                      <figure key={p.label} style={{ margin: 0 }}>
                        <PhotoThumb url={p.url} label={p.label} />
                        <figcaption className="subtle" style={{ fontSize: '10.5px', marginTop: '4px' }}>{p.label}</figcaption>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <p className="subtle" style={{ fontSize: '12.5px', margin: 0 }}>No photos on this record.</p>
                )}
              </div>
            )}

            {container.readyPhotoUrls.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
                  Ready to Move
                </div>
                <div className="photo-grid">
                  {container.readyPhotoUrls.map((url, i) => (
                    <figure key={url} style={{ margin: 0 }}>
                      <PhotoThumb url={url} label={`Ready to move ${i + 1}`} />
                      <figcaption className="subtle" style={{ fontSize: '10.5px', marginTop: '4px' }}>Ready to move {i + 1}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {!container.gateIn && !container.gateOut && container.readyPhotoUrls.length === 0 && (
              <EmptyState icon="gallery" title="No photos yet">
                Nothing uploaded on this container yet.
              </EmptyState>
            )}
          </div>
        </Modal>
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
          busy={deleteBusy}
          onConfirm={() => void handleDelete()}
        />
      )}

      {startConfirmDialog}
    </Modal>
  );
}
