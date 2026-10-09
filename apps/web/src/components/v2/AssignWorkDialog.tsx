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
import { Icon } from '../crystal/Icon';
import { Menu, Modal } from '../crystal/Overlay';

/** Which section a worker's type actually does, and — inside that section —
 * which tasks are theirs. A plain function, not a lookup table, because
 * Painter Helper needs a real predicate (only the tape/gasket and
 * compressor-and-display tasks, SPEC.md §4.3), not just a section match. */
function roleFilterFor(type: WorkerType): { kind: SectionKind; matchesTask: (task: MockTask) => boolean } | null {
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
    // Sailing Crew only ever appears against movements (load/offload/shift),
    // never a task — there's nothing task-shaped to assign them yet.
    case 'sailing_crew':
      return null;
  }
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
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: MockWorker | null;
  containers: MockContainer[];
  onAssignWorker: (containerId: string, kind: SectionKind, key: string, workerId: string) => void;
  onScheduleTask: (containerId: string, kind: SectionKind, key: string, date: string | null) => void;
  onUnassignTask: (containerId: string, kind: SectionKind, key: string) => void;
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

  useEffect(() => {
    if (open) {
      setDate(initialDate ?? offsetDate(0));
      setContainerId('');
      setPicked([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-running on every initialDate identity change would reset the in-progress date pick
  }, [open, worker?.id]);

  const roleFilter = worker ? roleFilterFor(worker.type) : null;

  // What this worker already has on the selected date — the "manipulate
  // what's already given" half of the dialog.
  const alreadyScheduled: LiveTask[] = worker ? tasksForWorker(containers, worker.id).filter((r) => isScheduledFor(r.task, date)) : [];

  // Containers with at least one open, role-matching, unassigned task —
  // nothing irrelevant to this worker's trade ever shows up in the list.
  const eligibleContainers = roleFilter
    ? containers.filter(
        (c) =>
          !c.departedAt &&
          c.sections.some(
            (s) => s.kind === roleFilter.kind && s.tasks.some((t) => !taskSettled(t) && t.state === 'pending' && !t.workerId && roleFilter.matchesTask(t))
          )
      )
    : [];

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
      {!worker ? null : !roleFilter ? (
        <div className="empty" style={{ padding: 'var(--s-4) 0' }}>
          <Icon name="user" size="lg" />
          <b>No assignable work for this role yet</b>
          <p>Sailing Crew work is logged through a container&rsquo;s Move action, not a daily assignment.</p>
        </div>
      ) : (
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
              {SECTION_LABELS[roleFilter.kind]} work to give them
            </div>
            {eligibleContainers.length === 0 ? (
              <p className="subtle" style={{ fontSize: '12.5px', margin: 0 }}>
                No container currently has open, unassigned {SECTION_LABELS[roleFilter.kind]} work.
              </p>
            ) : (
              <div className="stack">
                <Menu
                  label="Choose a container"
                  align="start"
                  trigger={
                    <button type="button" className="dd-trigger" style={{ width: '100%' }}>
                      {selectedContainer ? `${selectedContainer.id} — ${selectedContainer.typeCode}` : <span className="subtle">Choose a container</span>}
                      <Icon name="chev-down" size="sm" className="caret" />
                    </button>
                  }
                  items={eligibleContainers.map((c) => ({
                    label: `${c.id} — ${c.typeCode}`,
                    icon: c.id === containerId ? 'check' : undefined,
                    onSelect: () => setContainerId(c.id),
                  }))}
                />

                {selectedContainer && (
                  <div className="stack stack-tight" style={{ marginTop: 'var(--s-2)' }}>
                    {roleFilter.kind === 'painting' && selectedContainer.color && (
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
