import { createColumnHelper } from '@tanstack/react-table';
import { useCallback, useMemo, useState } from 'react';
import {
  formatElapsed,
  isScheduledFor,
  paintingTaskBlockedBy,
  SECTION_LABELS,
  taskElapsedSec,
  tasksBySection,
  tasksForWorker,
  WORKER_TYPE_LABELS,
  WORKER_TYPES,
  type CrewLoad,
  type LiveTask,
  type MockContainer,
  type MockTask,
  type MockWorker,
  type SectionKind,
  type WorkerType,
} from '../../lib/mockV2';
import { useLiveTick } from '../../lib/useLiveTick';
import { useV2Data } from '../../lib/v2Store';
import { AssignWorkDialog } from '../../components/v2/AssignWorkDialog';
import { ContainerDetailDrawer } from '../../components/v2/ContainerDetailDrawer';
import { MiniStageLegend, MiniStageStrip } from '../../components/v2/MiniStageStrip';
import { useStartGuard } from '../../components/v2/useStartGuard';
import { WorkerDetailDrawer } from '../../components/v2/WorkerDetailDrawer';
import { Button, Segmented } from '../../components/crystal/Button';
import { Person } from '../../components/crystal/Data';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState } from '../../components/crystal/Feedback';
import { Chip, InputWithIcon } from '../../components/crystal/Form';
import { Icon } from '../../components/crystal/Icon';

type View = 'stage' | 'crew';
type DisplayMode = 'cards' | 'list';
/** 'all' sits alongside the four real sections as a fifth filter value —
 * every open task, from every stage, in one table — so seeing everything
 * is the default, not something reached by first picking a category. */
type StageFilter = 'all' | SectionKind;
/** The product sub-filter, scoped under whichever stage is active — same
 * Reefer/Dry split the Yard Board's own stat cards already use (a Tank unit
 * counts as "Dry" there too, so this doesn't invent a third bucket nothing
 * else in the app recognizes). */
type ProductFilter = 'all' | 'Reefer' | 'Dry';
const productOf = (typeCode: string): 'Reefer' | 'Dry' => (typeCode.startsWith('Reefer') ? 'Reefer' : 'Dry');

const SECTION_KINDS: SectionKind[] = ['painting', 'pti', 'cleaning', 'all_rounder', 'sailing'];
const liveTaskColumnHelper = createColumnHelper<LiveTask>();
const crewColumnHelper = createColumnHelper<CrewLoad>();

/** Groups `rows` by section (each group pre-sorted by `compare`), then
 * merges them one-row-per-section-per-round instead of concatenating whole
 * groups — so a section with far fewer open tasks than Painting still gets
 * a seat on page 1, rather than only showing up after paging deep enough
 * to exhaust every other section first. */
function interleaveBySection(rows: LiveTask[], compare: (a: LiveTask, b: LiveTask) => number): LiveTask[] {
  const bySection = SECTION_KINDS.map((kind) => rows.filter((r) => r.section === kind).sort(compare));
  const maxLen = Math.max(0, ...bySection.map((group) => group.length));
  const merged: LiveTask[] = [];
  for (let i = 0; i < maxLen; i++) {
    for (const group of bySection) {
      if (group[i]) merged.push(group[i]!);
    }
  }
  return merged;
}

/**
 * A row of equal-size, filled segments with a visible gap between every one
 * — used for both the stage picker and the product picker beneath it, so
 * the two read as one consistent control, not two different widgets. Every
 * segment is the same size regardless of its count: "All" would otherwise
 * dwarf the rest, and width-by-count made the busiest option a bigger tap
 * target than the quietest one for no reason — the count is still right
 * there in the label. Deliberately plain bars, not a bar *chart* with
 * axes/gridlines — this is a selector first.
 */
function FilterRow<T extends string>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: Array<{ value: T; label: string; count: number }>;
  active: T;
  onSelect: (value: T) => void;
}): React.ReactElement {
  return (
    <div className="funnel" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="funnel-seg"
          aria-pressed={active === o.value}
          onClick={() => onSelect(o.value)}
        >
          <span className="funnel-label">{o.label}</span>
          <span className="funnel-count">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

/** The one action a task actually needs right now — Start or Stop — right
 * on the live row, so acting on it doesn't require opening the container's
 * full detail first.
 *
 * The painting-sequence guard (`paintingTaskBlockedBy`) has to be checked
 * here too, not just in Container Detail's own task table — otherwise this
 * quick action is a second, looser path to the exact bug item 9 fixed
 * earlier this engagement: starting a later painting step (e.g. Logo)
 * while an earlier one (e.g. 1st coat) is still running underneath it.
 *
 * No site-move gate here (confirming the container physically reached the
 * right site before Start unlocks) — that whole mechanism (`taskNeedsMove`,
 * `logMovement`) was dropped rather than left half-wired; nothing ever
 * called it, and keeping it would mean site-tracking UI (the removed
 * "Containers by site" panels) implying a liveness the app didn't actually
 * provide. Revisit as a real feature, with a real Move action, once it's
 * needed again — not by re-adding a silent gate with no way to clear it. */
function TaskQuickAction({
  containers,
  row,
  onStart,
  onStop,
  onCancel,
}: {
  containers: MockContainer[];
  row: LiveTask;
  onStart: (containerId: string, kind: SectionKind, key: string, task: MockTask) => void;
  onStop: (containerId: string, kind: SectionKind, key: string) => void;
  /** Undoes a mistaken Start — back to pending, worker stays assigned. */
  onCancel: (containerId: string, kind: SectionKind, key: string) => void;
}): React.ReactElement | null {
  const { task, containerId, section } = row;
  // Stops the click from also bubbling up to a card's own "open detail"
  // onClick where this is used in the cards grid below — harmless where
  // it's used today, inside a table cell with no row-level click handler.
  if (task.state === 'running') {
    return (
      <span className="cluster" style={{ gap: 'var(--s-2)' }}>
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(containerId, section, task.key);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon="check-circle"
          onClick={(e) => {
            e.stopPropagation();
            onStop(containerId, section, task.key);
          }}
        >
          Stop
        </Button>
      </span>
    );
  }
  if (task.state === 'pending' && task.workerId) {
    const sectionData = containers.find((c) => c.id === containerId)?.sections.find((s) => s.kind === section) ?? null;
    const blockedBy = sectionData ? paintingTaskBlockedBy(sectionData, task) : null;
    if (blockedBy) {
      return <span className="subtle" style={{ fontSize: '11px' }}>Waiting on {blockedBy.label}</span>;
    }
    return (
      <Button
        variant="secondary"
        size="sm"
        icon="clock"
        onClick={(e) => {
          e.stopPropagation();
          onStart(containerId, section, task.key, task);
        }}
      >
        Start
      </Button>
    );
  }
  return null;
}

/** Same card shape/interaction pattern established on Worker Roster: the
 * outer card's onClick is a mouse-only convenience (deliberately not given
 * its own role/keyboard handler — see the eslint-disable comment below for
 * why), and one real, scoped `<button>` inside it is the actual
 * keyboard-accessible trigger for the same action. Nesting other real
 * buttons (the quick action) alongside it is exactly what broke this last
 * time a wrapper carried its own `role="button"` too — see Worker Roster's
 * item 38 in DEVELOPMENT-STATUS.md — so this wrapper stays a plain div. */
function StageTaskCard({
  row,
  container,
  worker,
  showStage,
  now,
  onOpenContainer,
  onStart,
  onStop,
  onCancel,
}: {
  row: LiveTask;
  container: MockContainer | undefined;
  worker: MockWorker | undefined;
  showStage: boolean;
  now: number;
  onOpenContainer: (id: string) => void;
  onStart: (containerId: string, kind: SectionKind, key: string, task: MockTask) => void;
  onStop: (containerId: string, kind: SectionKind, key: string) => void;
  onCancel: (containerId: string, kind: SectionKind, key: string) => void;
}): React.ReactElement {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="card hoverable" style={{ breakInside: 'avoid', marginBottom: 'var(--s-4)' }} onClick={() => onOpenContainer(row.containerId)}>
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <span className="cluster" style={{ gap: 'var(--s-1)' }}>
          <button
            type="button"
            className="mono"
            style={{ font: 'inherit', fontWeight: 700, fontSize: '13px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)' }}
            onClick={(e) => {
              e.stopPropagation();
              onOpenContainer(row.containerId);
            }}
          >
            {row.containerId}
          </button>
          {container?.priority && <Icon name="alert" size="sm" title="Fast-track" />}
        </span>
        {showStage && <span className="subtle" style={{ fontSize: '11.5px' }}>{SECTION_LABELS[row.section]}</span>}
      </div>
      {container && (
        <div style={{ margin: 'var(--s-2) 0' }}>
          <MiniStageStrip container={container} />
        </div>
      )}
      <p style={{ fontSize: '12.5px', margin: '0 0 var(--s-2)' }}>{row.task.label}</p>
      <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)' }}>
        {worker ? <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} /> : <span className="subtle">Unassigned</span>}
        <span className="mono" style={{ fontSize: '12px', color: row.task.state === 'running' ? 'var(--accent)' : 'var(--text-3)' }}>
          {row.task.state === 'running' && <Icon name="clock" size="sm" />} {formatElapsed(taskElapsedSec(row.task, now))}
        </span>
      </div>
      <div className="cluster" style={{ marginTop: 'var(--s-3)' }}>
        <TaskQuickAction containers={container ? [container] : []} row={row} onStart={onStart} onStop={onStop} onCancel={onCancel} />
      </div>
    </div>
  );
}

/** Worker-roster-shaped card, scoped to one worker's load on the active
 * roster date — current task, waiting/done counts, and the same quick
 * actions the "By crew" table's row already offers. */
function CrewWorkerCard({
  load,
  isToday,
  now,
  onOpenWorker,
  onStop,
  onCancel,
  onAssign,
}: {
  load: CrewLoad;
  isToday: boolean;
  now: number;
  onOpenWorker: (id: string) => void;
  onStop: (containerId: string, kind: SectionKind, key: string) => void;
  onCancel: (containerId: string, kind: SectionKind, key: string) => void;
  onAssign: (workerId: string) => void;
}): React.ReactElement {
  const { worker, running, pending, doneToday } = load;
  const first = running[0];
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="card hoverable" style={{ breakInside: 'avoid', marginBottom: 'var(--s-4)' }} onClick={() => onOpenWorker(worker.id)}>
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          style={{ font: 'inherit', fontWeight: 700, fontSize: '13px', color: 'var(--text)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenWorker(worker.id);
          }}
        >
          {worker.name}
        </button>
        {first && (
          <span className="mono" style={{ fontSize: '12px', color: 'var(--accent)' }}>
            <Icon name="clock" size="sm" /> {formatElapsed(taskElapsedSec(first.task, now))}
          </span>
        )}
      </div>
      <p className="subtle" style={{ fontSize: '12.5px', margin: 'var(--s-1) 0 var(--s-2)' }}>
        {WORKER_TYPE_LABELS[worker.type]}
        {!worker.active && ' · inactive'}
      </p>
      <p style={{ fontSize: '12.5px', margin: '0 0 var(--s-2)' }}>
        {first
          ? `${first.task.label}${running.length > 1 ? ` +${running.length - 1} more` : ''}`
          : pending[0]
            ? `${pending[0].task.label} (not started)${pending.length > 1 ? ` +${pending.length - 1} more` : ''}`
            : 'Nothing scheduled'}
      </p>
      <span className="subtle" style={{ fontSize: '12px' }}>
        {pending.length} waiting · {doneToday.length} done
      </span>
      <div className="cluster" style={{ marginTop: 'var(--s-3)', gap: 'var(--s-2)' }}>
        {first && isToday && (
          <>
            <Button
              variant="ghost"
              size="sm"
              icon="x"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(first.containerId, first.section, first.task.key);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="check-circle"
              onClick={(e) => {
                e.stopPropagation();
                onStop(first.containerId, first.section, first.task.key);
              }}
            >
              Stop
            </Button>
          </>
        )}
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={(e) => {
            e.stopPropagation();
            onAssign(worker.id);
          }}
        >
          Assign work
        </Button>
      </div>
    </div>
  );
}

export function LiveBoard(): React.ReactElement {
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
    unassignTask,
    addTask,
    setTaskSite,
    markReady,
    toggleWorkerActive,
    updateWorker,
    removeWorker,
    updateContainer,
    removeContainer,
    setPriority,
    gateOut,
  } = useV2Data();
  // Live Board's own table has its own Start button, separate from Container
  // Detail's (which guards itself) — same two checks either way.
  const { attemptStart, confirmDialog: startConfirmDialog } = useStartGuard(containers, workers, startTask);
  const [view, setView] = useState<View>('stage');
  // Shared across both views, same toggle shape as Yard Board/Worker
  // Roster — switching "By stage"/"By crew" already swaps the whole table,
  // so one Cards/List control for both is simpler than two independent
  // ones with no real reason to ever disagree. Defaults to List, not
  // Cards — unlike the other two screens, Live Board was a table-only view
  // before this toggle existed, and the user asked to keep that the usual
  // default here; Cards is still one click away.
  const [displayMode, setDisplayMode] = useState<DisplayMode>('list');
  // Defaults to "All" — every open task across every section, one table —
  // so seeing the whole picture never requires picking a category first.
  // Narrowing to one stage is still a tap away when a yard this size makes
  // "All" too long to scroll.
  const [activeSection, setActiveSection] = useState<StageFilter>('all');
  // A sub-filter under the stage one — which product the open work belongs
  // to, not just which stage it's at.
  const [activeProduct, setActiveProduct] = useState<ProductFilter>('all');
  // Inline, board-local search — separate from the global command-palette
  // search, which jumps away from the board entirely. Matches the same way
  // the palette does (id + typeCode), just without leaving this screen.
  const [searchQuery, setSearchQuery] = useState('');
  const [openContainerId, setOpenContainerId] = useState<string | null>(null);
  const [openWorkerId, setOpenWorkerId] = useState<string | null>(null);
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // "By crew" is the daily roster — defaults to today, same as the rest of
  // the app's "what's happening right now" screens, but a plain date field
  // so looking at tomorrow's plan or yesterday's record is one click away.
  const [rosterDate, setRosterDate] = useState(todayStr);
  // Which trade the roster is narrowed to — same "all + one chip per type"
  // idiom Worker Roster already uses, so a big crew list is scannable by
  // role here too, not just on the dedicated roster screen.
  const [crewTypeFilter, setCrewTypeFilter] = useState<WorkerType | 'all'>('all');
  // Assigning directly from a crew row — no need to open the worker's full
  // profile drawer just to hand them another task.
  const [assignWorkerId, setAssignWorkerId] = useState<string | null>(null);

  const anyRunning = activeContainers.some((c) => c.sections.some((s) => s.tasks.some((t) => t.state === 'running')));
  const now = useLiveTick(anyRunning);

  // Every worker's load, scoped to the roster date — the same CrewLoad shape
  // crewLoad() itself returns, just filtered by isScheduledFor() first so an
  // unscheduled or differently-scheduled task never shows up on the wrong
  // day's roster. Running tasks are the one exception: useStartGuard's
  // "start ahead of schedule" path starts a task without touching
  // scheduledFor, so a task genuinely running right now could otherwise
  // vanish from today's roster entirely just because it was originally
  // planned for a different day.
  const byWorker: CrewLoad[] = useMemo(
    () =>
      workers.map((worker) => {
        const tasks = tasksForWorker(activeContainers, worker.id).filter(
          (t) => t.task.state === 'running' || isScheduledFor(t.task, rosterDate)
        );
        return {
          worker,
          running: tasks.filter((t) => t.task.state === 'running'),
          pending: tasks.filter((t) => t.task.state === 'pending'),
          doneToday: tasks.filter((t) => t.task.state === 'done'),
        };
      }),
    [activeContainers, workers, rosterDate]
  );
  const crewRows = crewTypeFilter === 'all' ? byWorker : byWorker.filter((r) => r.worker.type === crewTypeFilter);
  const containerPriority = useMemo(() => Object.fromEntries(activeContainers.map((c) => [c.id, c.priority])), [activeContainers]);
  const containerProduct = useMemo(() => Object.fromEntries(activeContainers.map((c) => [c.id, productOf(c.typeCode)])), [activeContainers]);
  const openContainer = containers.find((c) => c.id === openContainerId) ?? null;
  const openWorker = workers.find((w) => w.id === openWorkerId) ?? null;

  // The two drawers are mutually exclusive — opening one always closes the
  // other, so switching views never leaves a stale drawer open underneath.
  const handleOpenContainer = (id: string): void => {
    setOpenWorkerId(null);
    setOpenContainerId(id);
  };
  const handleOpenWorker = (id: string): void => {
    setOpenContainerId(null);
    setOpenWorkerId(id);
  };

  const openOnly = (r: LiveTask): boolean => r.task.state !== 'na' && r.task.state !== 'done';
  // Every open task, from every section, with its container's product
  // already resolvable — the one list both rows' counts and the table
  // filter all read from, so they can never drift out of sync with each
  // other.
  const allOpenRows = SECTION_KINDS.flatMap((kind) => tasksBySection(activeContainers, kind)).filter(openOnly);

  // Product is the primary split — each count is the total for that
  // product across the whole yard, independent of whichever stage
  // sub-filter happens to be selected below it.
  const productCounts: Array<{ value: ProductFilter; label: string; count: number }> = [
    { value: 'all', label: 'All', count: allOpenRows.length },
    { value: 'Reefer', label: 'Reefer', count: allOpenRows.filter((r) => containerProduct[r.containerId] === 'Reefer').length },
    { value: 'Dry', label: 'Dry', count: allOpenRows.filter((r) => containerProduct[r.containerId] === 'Dry').length },
  ];
  const rowsForProduct = activeProduct === 'all' ? allOpenRows : allOpenRows.filter((r) => containerProduct[r.containerId] === activeProduct);

  // Stage is the sub-filter, scoped under whichever product is active —
  // "Painting (12)" here means twelve *within the selected product*, not
  // across the whole yard.
  const stageCounts: Array<{ kind: StageFilter; label: string; count: number }> = [
    { kind: 'all', label: 'All', count: rowsForProduct.length },
    ...SECTION_KINDS.map((kind) => ({
      kind: kind as StageFilter,
      label: SECTION_LABELS[kind],
      count: rowsForProduct.filter((r) => r.section === kind).length,
    })),
  ];

  const byPriority = (a: LiveTask, b: LiveTask): number => Number(containerPriority[b.containerId]) - Number(containerPriority[a.containerId]);

  // Live Board shows what still needs doing, not a completed-work log
  // (that's the Ready to Move report) — so a settled task doesn't get a row
  // here, matching the two rows' own counts. "All" stages round-robins the
  // four sections together instead of fully grouping them — Painting alone
  // has far more open tasks than the other three combined (64 vs. 49/23/24
  // in a typical yard), so a straight group-by-section sort buried every
  // PTI/Cleaning/Repairment row behind 5+ pages of nothing but Painting,
  // making the rest of the yard's work look like it didn't exist ("the
  // system is only showing Painting"). Priority still wins within each
  // section's own turn in the rotation, just not across the whole table.
  const stageRowsUnfiltered =
    activeSection === 'all' ? interleaveBySection(rowsForProduct, byPriority) : rowsForProduct.filter((r) => r.section === activeSection).sort(byPriority);
  const searchNeedle = searchQuery.trim().toLowerCase();
  const stageRows = searchNeedle
    ? stageRowsUnfiltered.filter((r) => `${r.containerId} ${r.containerTypeCode}`.toLowerCase().includes(searchNeedle))
    : stageRowsUnfiltered;

  // Deliberately its own useCallback, not just inlined in stageColumns below
  // — stageColumns itself is rebuilt every render (including Live Board's
  // per-second live-timer tick, via useLiveTick), so an inline arrow
  // function here would get a fresh identity every second. React treats a
  // new function identity as a new component type at that tree position and
  // remounts it, which silently resets any open Radix popover/dropdown
  // inside it back to closed (this is what made the old "Move" menu here
  // appear to close itself — see useStartGuard.tsx). Keeping this renderer
  // referentially stable (same identity across ticks, since none of its own
  // dependencies change just from the clock advancing) is what actually
  // avoids that, not memoizing the column array as a whole — the "Time"
  // column still needs to rebuild every second, just not this one.
  const renderStageAction = useCallback(
    (ctx: { row: { original: LiveTask } }) => (
      <TaskQuickAction containers={activeContainers} row={ctx.row.original} onStart={attemptStart} onStop={stopTask} onCancel={cancelTask} />
    ),
    [activeContainers, attemptStart, stopTask, cancelTask]
  );

  const stageColumns = [
    liveTaskColumnHelper.accessor('containerId', {
      header: 'Container',
      meta: { label: 'Container', lead: true },
      enableSorting: false,
      cell: (ctx) => (
        <span className="cluster" style={{ gap: 'var(--s-1)' }}>
          <span className="mono">{ctx.getValue()}</span>
          {containerPriority[ctx.getValue()] && <Icon name="alert" size="sm" title="Fast-track" />}
        </span>
      ),
    }),
    ...(activeSection === 'all'
      ? [
          liveTaskColumnHelper.display({
            id: 'stage',
            header: 'Stage',
            meta: { label: 'Stage' },
            cell: (ctx: { row: { original: LiveTask } }) => SECTION_LABELS[ctx.row.original.section],
          }),
        ]
      : []),
    liveTaskColumnHelper.display({
      id: 'progress',
      header: 'Progress',
      meta: { label: 'Progress', secondary: true },
      cell: (ctx) => {
        const c = activeContainers.find((x) => x.id === ctx.row.original.containerId);
        return c ? <MiniStageStrip container={c} /> : null;
      },
    }),
    liveTaskColumnHelper.display({
      id: 'task',
      header: 'Task',
      meta: { label: 'Task' },
      cell: (ctx) => ctx.row.original.task.label,
    }),
    liveTaskColumnHelper.display({
      id: 'worker',
      header: 'Worker',
      meta: { label: 'Worker', secondary: true },
      cell: (ctx) => {
        const worker = workers.find((w) => w.id === ctx.row.original.task.workerId);
        return worker ? <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} /> : <span className="subtle">Unassigned</span>;
      },
    }),
    liveTaskColumnHelper.display({
      id: 'time',
      header: 'Time',
      meta: { label: 'Time', secondary: true },
      cell: (ctx) => {
        const { task } = ctx.row.original;
        return (
          <span className="mono" style={{ fontSize: '12px', color: task.state === 'running' ? 'var(--accent)' : 'var(--text-3)' }}>
            {task.state === 'running' && <Icon name="clock" size="sm" />} {formatElapsed(taskElapsedSec(task, now))}
          </span>
        );
      },
    }),
    liveTaskColumnHelper.display({
      id: 'action',
      header: 'Action',
      meta: { label: 'Action' },
      cell: renderStageAction,
    }),
  ];

  const crewColumns = [
    crewColumnHelper.accessor((r) => r.worker.name, {
      id: 'worker',
      header: 'Worker',
      meta: { label: 'Worker', lead: true },
      cell: (ctx) => {
        const { worker } = ctx.row.original;
        return (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} />
            {!worker.active && <span className="subtle">inactive</span>}
          </span>
        );
      },
    }),
    crewColumnHelper.display({
      id: 'task',
      header: 'Current task',
      meta: { label: 'Current task' },
      cell: (ctx) => {
        const { running, pending } = ctx.row.original;
        if (running.length > 0) {
          const extra = running.length > 1 ? ` +${running.length - 1} more` : '';
          return (
            <span>
              {running[0]!.task.label}
              {extra && <span className="subtle">{extra}</span>}
            </span>
          );
        }
        // Nothing running yet doesn't mean nothing scheduled — a future
        // roster date never has a running task, only a planned one.
        if (pending.length > 0) {
          const extra = pending.length > 1 ? ` +${pending.length - 1} more` : '';
          return (
            <span className="subtle">
              {pending[0]!.task.label} (not started)
              {extra}
            </span>
          );
        }
        return <span className="subtle">Nothing scheduled</span>;
      },
    }),
    crewColumnHelper.display({
      id: 'time',
      header: 'Time',
      meta: { label: 'Time', secondary: true },
      cell: (ctx) => {
        const first = ctx.row.original.running[0];
        if (!first) return <span className="subtle">—</span>;
        return (
          <span className="mono" style={{ fontSize: '12px', color: 'var(--accent)' }}>
            <Icon name="clock" size="sm" /> {formatElapsed(taskElapsedSec(first.task, now))}
          </span>
        );
      },
    }),
    crewColumnHelper.display({
      id: 'waiting',
      header: 'Waiting',
      meta: { label: 'Waiting', num: true, secondary: true },
      cell: (ctx) => ctx.row.original.pending.length,
    }),
    crewColumnHelper.display({
      id: 'done',
      header: 'Done',
      meta: { label: 'Done', num: true, secondary: true },
      cell: (ctx) => ctx.row.original.doneToday.length,
    }),
    crewColumnHelper.display({
      id: 'action',
      header: 'Action',
      meta: { label: 'Action' },
      cell: (ctx) => {
        const first = ctx.row.original.running[0];
        // Looking at a day other than today is a plan or a record, not a
        // live view — nothing on it is actionable in real time.
        if (!first || rosterDate !== todayStr) return <span className="subtle">—</span>;
        return (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <Button variant="ghost" size="sm" icon="x" onClick={() => cancelTask(first.containerId, first.section, first.task.key)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" icon="check-circle" onClick={() => stopTask(first.containerId, first.section, first.task.key)}>
              Stop
            </Button>
          </span>
        );
      },
    }),
    crewColumnHelper.display({
      id: 'assign',
      header: 'Assign',
      meta: { label: 'Assign' },
      cell: (ctx) => (
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setAssignWorkerId(ctx.row.original.worker.id)}>
          Assign work
        </Button>
      ),
    }),
  ];

  // Shared between each view's List-mode DataTable and its Cards-mode empty
  // check, so the message never drifts out of sync between the two.
  const stageEmpty = (
    <EmptyState icon="check-circle" title="Nothing open here">
      {activeSection === 'all' && activeProduct === 'all'
        ? 'Nothing open anywhere in the yard.'
        : `No ${activeProduct === 'all' ? '' : `${activeProduct} `}containers currently need ${activeSection === 'all' ? 'anything' : SECTION_LABELS[activeSection]}.`}
    </EmptyState>
  );
  const crewEmpty = (
    <EmptyState icon="user" title="Nothing scheduled">
      No one is assigned anything on this date yet.
    </EmptyState>
  );

  return (
    // Tight, not loose: the toggle and the two filter rows below it are all
    // controls for the same view, not independent sections — stack-loose's
    // 24px gaps were section-sized spacing for what's really one control
    // cluster, eating space the table itself needed.
    <div className="stack stack-tight">
      <div className="cluster" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
        <Segmented
          value={view}
          onChange={setView}
          label="Live view"
          options={[
            { value: 'stage', label: 'By stage' },
            { value: 'crew', label: 'By crew' },
          ]}
        />
        {view === 'stage' && (
          <InputWithIcon
            icon="search"
            placeholder="Search container number…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ maxWidth: '280px' }}
          />
        )}
      </div>

      {view === 'stage' && (
        <div className="stack stack-tight">
          <FilterRow label="Product" options={productCounts} active={activeProduct} onSelect={setActiveProduct} />
          {/* Lighter than the product row on purpose — this is a narrowing
             sub-filter under it, scoped to whichever product is selected
             above, not a second peer control. */}
          <div className="cluster" role="group" aria-label="Stage" style={{ gap: 'var(--s-2)' }}>
            {stageCounts.map((s) => (
              <Chip key={s.kind} pressed={activeSection === s.kind} onClick={() => setActiveSection(s.kind)}>
                {s.label} ({s.count})
              </Chip>
            ))}
          </div>
          <MiniStageLegend />
        </div>
      )}

      {view === 'crew' && (
        <div className="stack stack-tight">
          <div className="cluster" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
            <span className="subtle" style={{ fontSize: '12px' }}>Roster for</span>
            <input className="input" type="date" style={{ width: 'auto', height: '36px' }} value={rosterDate} onChange={(e) => setRosterDate(e.target.value)} />
            {rosterDate !== todayStr && (
              <Button variant="ghost" size="sm" onClick={() => setRosterDate(todayStr)}>
                Back to today
              </Button>
            )}
          </div>
          <div className="cluster" role="group" aria-label="Worker type" style={{ gap: 'var(--s-2)' }}>
            <Chip pressed={crewTypeFilter === 'all'} onClick={() => setCrewTypeFilter('all')}>
              All
            </Chip>
            {WORKER_TYPES.map((t) => (
              <Chip key={t} pressed={crewTypeFilter === t} onClick={() => setCrewTypeFilter(t)}>
                {WORKER_TYPE_LABELS[t]}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="cluster" style={{ justifyContent: 'flex-end' }}>
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

      {view === 'stage' ? (
        displayMode === 'list' ? (
          <DataTable
            data={stageRows}
            columns={stageColumns}
            getRowId={(r) => `${r.containerId}-${r.task.key}`}
            caption={`${activeProduct === 'all' ? 'All' : activeProduct}${activeSection === 'all' ? '' : ` · ${SECTION_LABELS[activeSection]}`} — open work`}
            onRowOpen={(r) => handleOpenContainer(r.containerId)}
            rowLabel={(r) => `${r.containerId} — ${r.task.label}`}
            pageSize={12}
            empty={stageEmpty}
          />
        ) : stageRows.length === 0 ? (
          stageEmpty
        ) : (
          // CSS multi-column, not CSS Grid — see Yard Board's own card grid
          // for why: a grid row's height is set by its tallest cell, and
          // these task cards vary a lot (an unassigned task with no quick
          // action is far shorter than a running one with a worker and
          // elapsed time). Columns let each card pack to its own height.
          <div style={{ columnWidth: '300px', columnGap: 'var(--s-4)' }}>
            {stageRows.map((row) => (
              <StageTaskCard
                key={`${row.containerId}-${row.task.key}`}
                row={row}
                container={activeContainers.find((c) => c.id === row.containerId)}
                worker={workers.find((w) => w.id === row.task.workerId)}
                showStage={activeSection === 'all'}
                now={now}
                onOpenContainer={handleOpenContainer}
                onStart={attemptStart}
                onStop={stopTask}
                onCancel={cancelTask}
              />
            ))}
          </div>
        )
      ) : displayMode === 'list' ? (
        <DataTable
          data={crewRows}
          columns={crewColumns}
          getRowId={(r) => r.worker.id}
          caption={`Crew — ${rosterDate === todayStr ? 'today' : rosterDate}`}
          onRowOpen={(r) => handleOpenWorker(r.worker.id)}
          rowLabel={(r) => r.worker.name}
          pageSize={20}
          empty={crewEmpty}
        />
      ) : crewRows.length === 0 ? (
        crewEmpty
      ) : (
        <div style={{ columnWidth: '260px', columnGap: 'var(--s-4)' }}>
          {crewRows.map((load) => (
            <CrewWorkerCard
              key={load.worker.id}
              load={load}
              isToday={rosterDate === todayStr}
              now={now}
              onOpenWorker={handleOpenWorker}
              onStop={stopTask}
              onCancel={cancelTask}
              onAssign={setAssignWorkerId}
            />
          ))}
        </div>
      )}

      <ContainerDetailDrawer
        container={openContainer}
        workers={workers}
        containers={containers}
        onOpenChange={(next) => !next && setOpenContainerId(null)}
        onStart={startTask}
        onStop={stopTask}
        onCancel={cancelTask}
        onMarkNA={markTaskNA}
        onAssignWorker={assignWorker}
        onScheduleTask={scheduleTask}
        onSetTaskSite={setTaskSite}
        onMarkReady={markReady}
        onUpdateContainer={updateContainer}
        onRemoveContainer={removeContainer}
        onSetPriority={setPriority}
        onGateOut={gateOut}
      />
      <WorkerDetailDrawer
        worker={openWorker}
        containers={containers}
        onOpenChange={(next) => !next && setOpenWorkerId(null)}
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
        initialDate={rosterDate}
      />
      {startConfirmDialog}
    </div>
  );
}
