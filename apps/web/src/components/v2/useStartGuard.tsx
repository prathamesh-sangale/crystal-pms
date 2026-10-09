import { useCallback, useState } from 'react';
import { offsetDate, scheduleLabel, tasksForWorker, type MockContainer, type MockWorker, type SectionKind } from '../../lib/mockV2';
import { useToast } from '../crystal/Feedback';
import { ConfirmDialog } from '../crystal/Overlay';

interface StartableTask {
  label: string;
  workerId: string | null;
  scheduledFor?: string | null;
}

/**
 * The one place "Start" gets checked before a task actually begins running —
 * shared by Live Board's quick action and Container Detail's task table, so
 * neither one can start a task more permissively than the other.
 *
 * Two different guards, two different responses, on purpose:
 * - A worker already running something else can't *also* run this — a
 *   person can only physically do one thing at a time. Nothing to confirm;
 *   the task simply stays queued (it's already sitting in their "today"
 *   list as pending/waiting) and a toast says why it didn't start.
 * - A task scheduled for a different day is a plan, not a lock. Confirm,
 *   and the admin can start it anyway — plans change.
 */
export function useStartGuard(
  containers: MockContainer[],
  workers: MockWorker[],
  onStart: (containerId: string, kind: SectionKind, key: string) => void
): {
  attemptStart: (containerId: string, kind: SectionKind, key: string, task: StartableTask) => void;
  confirmDialog: React.ReactElement;
} {
  const toast = useToast();
  const [pending, setPending] = useState<{ containerId: string; kind: SectionKind; key: string; label: string; date: string } | null>(null);

  // Stable across re-renders (e.g. Live Board's per-second live-timer tick)
  // so anything that closes over this — like a cell renderer passed to
  // flexRender — doesn't get a new identity every second. A new identity
  // there means React remounts that cell's component tree on every tick,
  // which silently resets any open Radix popover/dropdown inside it back to
  // closed — exactly what made Live Board's "Move" menu appear to open and
  // immediately close on its own.
  const attemptStart = useCallback(
    (containerId: string, kind: SectionKind, key: string, task: StartableTask): void => {
      if (task.workerId) {
        const busy = tasksForWorker(containers, task.workerId).find((t) => t.task.state === 'running');
        if (busy) {
          const worker = workers.find((w) => w.id === task.workerId);
          toast.toast(
            'info',
            'Worker is busy',
            `${worker?.name ?? 'This worker'} is already running ${busy.task.label} on ${busy.containerId} — ${task.label} stays queued for today, next up once they're free.`
          );
          return;
        }
      }
      if (task.scheduledFor && task.scheduledFor !== offsetDate(0)) {
        setPending({ containerId, kind, key, label: task.label, date: task.scheduledFor });
        return;
      }
      onStart(containerId, kind, key);
    },
    [containers, workers, onStart, toast]
  );

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(next) => !next && setPending(null)}
      title="Start ahead of schedule?"
      body={pending ? `${pending.label} is scheduled for ${scheduleLabel(pending.date)}, not today. Start it now anyway?` : null}
      confirmLabel="Start anyway"
      onConfirm={() => {
        if (pending) onStart(pending.containerId, pending.kind, pending.key);
        setPending(null);
      }}
    />
  );

  return { attemptStart, confirmDialog };
}
