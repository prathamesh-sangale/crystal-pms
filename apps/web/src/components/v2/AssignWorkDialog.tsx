import { useEffect, useState } from 'react';
import {
  isScheduledFor,
  offsetDate,
  RESCHEDULE_OFFSETS,
  SECTION_LABELS,
  scheduleLabel,
  tasksForWorker,
  taskSettled,
  type LiveTask,
  type MockContainer,
  type MockTask,
  type MockWorker,
  type SectionKind,
  type WorkerType,
} from '../../lib/mockV2';
import { Button } from '../crystal/Button';
import { Pill } from '../crystal/Data';
import { Select } from '../crystal/Form';
import { Icon } from '../crystal/Icon';
import { Modal } from '../crystal/Overlay';

/** Which section a worker's type actually does, and — inside that section —
 * which tasks are theirs. A plain function, not a lookup table, because
 * Painter Helper needs a real predicate (only the tape/gasket and
 * compressor-and-display tasks, SPEC.md §4.3), not just a section match. */
function roleFilterFor(type: WorkerType): { kind: SectionKind; matchesTask: (task: MockTask) => boolean } {
  switch (type) {
    case 'painter':
      return { kind: 'painting', matchesTask: (t) => !t.ownerType || t.ownerType === 'painter' };
    case 'painter_helper':
      return { kind: 'painting', matchesTask: (t) => t.ownerType === 'painter_helper' };
    case 'technician':
      return { kind: 'pti', matchesTask: () => true };
    // Covers cleaning when needed, per the Tea Boy roster note — no section
    // of their own in the data model, so this is the closest real fit.
    case 'cleaner':
    case 'tea_boy':
      return { kind: 'cleaning', matchesTask: () => true };
    case 'all_rounder':
      return { kind: 'all_rounder', matchesTask: () => true };
    case 'sailing_crew':
      return { kind: 'sailing', matchesTask: () => true };
  }
}

/** Preset labels offered under "Add a new task" for each role — on top of
 * whatever's already pending from Gate-In. Client request: these roles had
 * no way to get new, specifically-labelled work added once a container was
 * already in the yard (sticker removal, office cleaning, a new repair, a
 * Sailing Crew container move — none of these come from the fixed Gate-In
 * builders). A free-text "Other" option is always offered alongside these,
 * regardless of role. */
const ROLE_TASK_PRESETS: Partial<Record<WorkerType, string[]>> = {
  cleaner: ['Yard cleaning', 'Washroom cleaning', 'Kitchen cleaning', 'Office cleaning'],
  tea_boy: ['Yard cleaning', 'Washroom cleaning', 'Kitchen cleaning', 'Office cleaning'],
  all_rounder: ['Painting', 'Dry repair', 'Reefer repair'],
  painter: ['Sticker removing'],
  sailing_crew: ['Loading', 'Unloading', 'Shifting', 'Container list'],
};

/** A stable, readable task key from a label — lowercase, hyphenated, with a
 * short suffix so picking the same preset twice on the same container never
 * collides (e.g. "Yard cleaning" added on two different days). */
function taskKeyFor(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${slug}-${Date.now().toString(36)}`;
}

/**
 * Assigning work from the worker's own side: pick a day, see (and clear)
 * whatever's already scheduled for it, then pick a container and the
 * specific role-matching tasks to give them — the container-side Assign
 * flow in ContainerDetailDrawer still exists and works exactly as before;
 * this is a second, worker-first way in, not a replacement.
 */
export function AssignWorkDialog({
  open,
  onOpenChange,
  worker,
  containers,
  onAssignWorker,
  onScheduleTask,
  onUnassignTask,
  onAddTask,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: MockWorker | null;
  containers: MockContainer[];
  onAssignWorker: (containerId: string, kind: SectionKind, key: string, workerId: string) => void;
  onScheduleTask: (containerId: string, kind: SectionKind, key: string, date: string | null) => void;
  onUnassignTask: (containerId: string, kind: SectionKind, key: string) => void;
  /** Creates a brand-new task — the "Add a new task" flow below, and PTI's
   * "Flag repair needed" shortcut (which adds to the all_rounder section,
   * not PTI's own, unassigned — for an All-Rounder to pick up later). */
  onAddTask: (containerId: string, kind: SectionKind, task: { key: string; label: string; workerId: string | null; site: null }) => Promise<void>;
  /** Defaults to today. Callers that already have a date in view — the "By
   * crew" roster, say — pass it through so opening the dialog from a row on
   * tomorrow's roster starts on tomorrow, not today. */
  initialDate?: string;
}): React.ReactElement {
  const [date, setDate] = useState(initialDate ?? offsetDate(0));
  const [containerId, setContainerId] = useState('');
  // What's been picked so far, across every container visited this session
  // — switching the container dropdown used to wipe this, which meant a
  // worker could only ever get tasks from one container per confirm. Keyed
  // by containerId+key since task keys (e.g. "logo") repeat across
  // containers.
  const [picked, setPicked] = useState<Array<{ containerId: string; kind: SectionKind; key: string; label: string }>>([]);
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [flaggingRepair, setFlaggingRepair] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(initialDate ?? offsetDate(0));
      setContainerId('');
      setPicked([]);
      setNewTaskLabel('');
      setCustomLabel('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running on every initialDate identity change would reset the in-progress date pick
  }, [open, worker?.id]);

  const roleFilter = worker ? roleFilterFor(worker.type) : null;

  // What this worker already has on the selected date — the "manipulate
  // what's already given" half of the dialog.
  const alreadyScheduled: LiveTask[] = worker ? tasksForWorker(containers, worker.id).filter((r) => isScheduledFor(r.task, date)) : [];

  // Every active container, not just ones with a pre-existing matching
  // task — "Add a new task" below means there's always somewhere to put
  // new work, even for a role (Sailing Crew) or label (sticker removing,
  // office cleaning) nothing was ever generated for at Gate-In.
  const eligibleContainers = roleFilter ? containers.filter((c) => !c.departedAt) : [];

  const selectedContainer = containers.find((c) => c.id === containerId) ?? null;
  const section = selectedContainer?.sections.find((s) => s.kind === roleFilter?.kind) ?? null;
  const pickableTasks = section && roleFilter ? section.tasks.filter((t) => !taskSettled(t) && t.state === 'pending' && !t.workerId && roleFilter.matchesTask(t)) : [];

  const isPicked = (key: string): boolean => picked.some((p) => p.containerId === containerId && p.key === key);

  const toggleTask = (task: MockTask): void => {
    if (!selectedContainer || !section) return;
    setPicked((cur) => {
      if (cur.some((p) => p.containerId === selectedContainer.id && p.key === task.key)) {
        return cur.filter((p) => !(p.containerId === selectedContainer.id && p.key === task.key));
      }
      return [...cur, { containerId: selectedContainer.id, kind: section.kind, key: task.key, label: task.label }];
    });
  };

  const removePicked = (containerId: string, key: string): void => {
    setPicked((cur) => cur.filter((p) => !(p.containerId === containerId && p.key === key)));
  };

  const [repairFlaggedFor, setRepairFlaggedFor] = useState<string | null>(null);

  // PTI finding a problem is reported against a different section
  // (all_rounder/Repairment) than the technician's own — it's not assigned
  // to them, just left open for an All-Rounder to pick up normally.
  const handleFlagRepair = async (): Promise<void> => {
    if (!selectedContainer) return;
    setFlaggingRepair(true);
    try {
      await onAddTask(selectedContainer.id, 'all_rounder', {
        key: taskKeyFor('repair-required'),
        label: 'Repair required',
        workerId: null,
        site: null,
      });
      setRepairFlaggedFor(selectedContainer.id);
    } finally {
      setFlaggingRepair(false);
    }
  };

  const handleAddNewTask = async (): Promise<void> => {
    if (!selectedContainer || !roleFilter || !worker) return;
    const label = (newTaskLabel === 'Other' ? customLabel : newTaskLabel).trim();
    if (!label) return;
    const key = taskKeyFor(label);
    setAddingTask(true);
    try {
      await onAddTask(selectedContainer.id, roleFilter.kind, { key, label, workerId: null, site: null });
      setPicked((cur) => [...cur, { containerId: selectedContainer.id, kind: roleFilter.kind, key, label }]);
      setNewTaskLabel('');
      setCustomLabel('');
    } finally {
      setAddingTask(false);
    }
  };

  const handleConfirm = (): void => {
    if (!worker || picked.length === 0) return;
    for (const p of picked) {
      onAssignWorker(p.containerId, p.kind, p.key, worker.id);
      onScheduleTask(p.containerId, p.kind, p.key, date);
    }
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Assign work — ${worker?.name ?? ''}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon="check-circle" onClick={handleConfirm} disabled={picked.length === 0}>
            Assign {picked.length > 0 ? picked.length : ''} task{picked.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!worker ? null : (
        <div className="stack stack-loose">
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
              Date
            </div>
            <div className="cluster" style={{ gap: 'var(--s-2)' }}>
              {RESCHEDULE_OFFSETS.map((o) => (
                <button
                  key={o.days}
                  type="button"
                  className="chip"
                  aria-pressed={date === offsetDate(o.days)}
                  onClick={() => setDate(offsetDate(o.days))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {alreadyScheduled.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
                Already scheduled for {scheduleLabel(date)}
              </div>
              <div className="stack stack-tight">
                {alreadyScheduled.map((row) => (
                  <div
                    key={`${row.containerId}-${row.task.key}`}
                    className="cluster"
                    style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}
                  >
                    <span style={{ fontSize: '12.5px' }}>
                      <b>{row.task.label}</b> <span className="subtle mono">{row.containerId}</span>
                    </span>
                    <Button variant="ghost" size="sm" icon="x" onClick={() => onUnassignTask(row.containerId, row.section, row.task.key)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
              {SECTION_LABELS[roleFilter!.kind]} work to give them
            </div>
            {eligibleContainers.length === 0 ? (
              <p className="subtle" style={{ fontSize: '12.5px', margin: 0 }}>
                No containers currently in the yard.
              </p>
            ) : (
              <div className="stack">
                {/* A plain native <select>, not the Menu dropdown used
                   elsewhere — "Add a new task" (below) needs every active
                   container as an option, not just ones with a pre-existing
                   matching task, and a 40+-item list overflows Menu's
                   unscrolled popover (it was only ever sized for a handful
                   of items). A native select handles any length natively. */}
                <Select value={containerId} onChange={(e) => setContainerId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">Choose a container</option>
                  {eligibleContainers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} — {c.typeCode}
                    </option>
                  ))}
                </Select>

                {selectedContainer && (
                  <div className="stack stack-tight" style={{ marginTop: 'var(--s-2)' }}>
                    {roleFilter!.kind === 'painting' && selectedContainer.color && (
                      <p className="subtle" style={{ fontSize: '11.5px', margin: '0 0 var(--s-1)' }}>
                        Paint colour: <b style={{ color: 'var(--text)' }}>{selectedContainer.color}</b>
                      </p>
                    )}
                    {pickableTasks.length === 0 ? (
                      <p className="subtle" style={{ fontSize: '12.5px', margin: 0 }}>
                        Nothing left unassigned here for this role.
                      </p>
                    ) : (
                      // Add-to-cart, not a tick-list: picking a task moves it down into
                      // "Selected to assign" and leaves an empty placeholder in its
                      // spot here, so it's obvious at a glance what's already been
                      // picked up without the list reflowing underneath you.
                      pickableTasks.map((t) =>
                        isPicked(t.key) ? (
                          <div
                            key={t.key}
                            className="cluster"
                            style={{
                              justifyContent: 'space-between',
                              padding: 'var(--s-2)',
                              border: '1.5px dashed var(--line-strong)',
                              borderRadius: 'var(--r-md)',
                            }}
                          >
                            <span className="subtle" style={{ fontSize: '12.5px' }}>
                              Added — see selection below
                            </span>
                            <Icon name="check" size="sm" />
                          </div>
                        ) : (
                          <div
                            key={t.key}
                            className="cluster"
                            style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}
                          >
                            <span className="cluster" style={{ gap: 'var(--s-2)', fontSize: '12.5px' }}>
                              {/* Repairment work is a flagged defect, not a
                                 routine step — called out with the same
                                 warn tone the rest of the app uses for
                                 anything that needs attention, so it never
                                 reads as just another checklist line. */}
                              {t.label.startsWith('Repair:') && (
                                <Pill tone="warn" icon="alert">
                                  Repair
                                </Pill>
                              )}
                              <b>{t.label.replace(/^Repair:\s*/, '')}</b>
                            </span>
                            <Button variant="secondary" size="sm" icon="plus" onClick={() => toggleTask(t)}>
                              Add
                            </Button>
                          </div>
                        )
                      )
                    )}

                    {roleFilter!.kind === 'pti' && (
                      <div className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderTop: '1px solid var(--line)', marginTop: 'var(--s-1)' }}>
                        <span className="subtle" style={{ fontSize: '12px' }}>
                          {repairFlaggedFor === selectedContainer.id ? 'Repair flagged — an All-Rounder can pick it up.' : 'Found something that needs fixing?'}
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="alert"
                          loading={flaggingRepair}
                          disabled={flaggingRepair || repairFlaggedFor === selectedContainer.id}
                          onClick={() => void handleFlagRepair()}
                        >
                          Flag repair needed
                        </Button>
                      </div>
                    )}

                    <div style={{ marginTop: 'var(--s-2)', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line)' }}>
                      <span className="subtle" style={{ fontSize: '11px' }}>Add a new task</span>
                      <div className="cluster" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-1)' }}>
                        {(ROLE_TASK_PRESETS[worker.type] ?? []).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className="chip"
                            aria-pressed={newTaskLabel === preset}
                            onClick={() => setNewTaskLabel(newTaskLabel === preset ? '' : preset)}
                          >
                            {preset}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="chip"
                          aria-pressed={newTaskLabel === 'Other'}
                          onClick={() => setNewTaskLabel(newTaskLabel === 'Other' ? '' : 'Other')}
                        >
                          Other
                        </button>
                      </div>
                      {newTaskLabel === 'Other' && (
                        <input
                          className="input"
                          style={{ marginTop: 'var(--s-2)' }}
                          placeholder="Describe the task"
                          value={customLabel}
                          onChange={(e) => setCustomLabel(e.target.value)}
                        />
                      )}
                      {newTaskLabel && (
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="plus"
                          style={{ marginTop: 'var(--s-2)' }}
                          loading={addingTask}
                          disabled={addingTask || (newTaskLabel === 'Other' && !customLabel.trim())}
                          onClick={() => void handleAddNewTask()}
                        >
                          Add
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Picking from another container doesn't lose what was
                   already ticked elsewhere — everything here goes out in
                   one "Assign" together, however many containers it spans. */}
                {picked.length > 0 && (
                  <div className="stack stack-tight" style={{ marginTop: 'var(--s-2)', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line)' }}>
                    <span className="subtle" style={{ fontSize: '11px' }}>
                      Selected to assign for {scheduleLabel(date)}
                    </span>
                    {picked.map((p) => (
                      <div key={`${p.containerId}-${p.key}`} className="cluster" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12.5px' }}>
                          <b>{p.label}</b> <span className="subtle mono">{p.containerId}</span>
                        </span>
                        <Button variant="ghost" size="sm" icon="x" onClick={() => removePicked(p.containerId, p.key)}>
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
