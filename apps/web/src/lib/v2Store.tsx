import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, type NewTaskInput } from './api';
import {
  type ContainerDraft,
  type ContainerDraftData,
  type GateLogEntry,
  type MockContainer,
  type MockWorker,
  type SailingSite,
  type SectionKind,
  type WorkerType,
} from './mockV2';

type ContainerEdit = Pick<MockContainer, 'typeCode' | 'size' | 'color'>;

/**
 * Shared, Supabase-backed state for every v2 screen (SPEC.md).
 *
 * Without this, each screen held its own private copy of the data — starting
 * a timer on the Yard Board would never show up on a "live" crew or stage
 * view, because there was no single source of truth to be live *from*. One
 * provider, mounted once above the v2 routes, fixes that.
 */

type Task = MockContainer['sections'][number]['tasks'][number];

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function mapContainer(containers: MockContainer[], id: string, fn: (c: MockContainer) => MockContainer): MockContainer[] {
  return containers.map((c) => (c.id === id ? fn(c) : c));
}

function mapTask(container: MockContainer, sectionKind: SectionKind, taskKey: string, fn: (t: Task) => Task): MockContainer {
  return {
    ...container,
    sections: container.sections.map((s) => (s.kind === sectionKind ? { ...s, tasks: s.tasks.map((t) => (t.key === taskKey ? fn(t) : t)) } : s)),
  };
}

interface V2Data {
  containers: MockContainer[];
  /** `containers` filtered to whatever hasn't been gated out yet — what
   * "the yard" means on the Yard Board, Live Board and Dashboards. The
   * per-container report, Yard Report, and Command Palette all need
   * departed containers too, so they keep using `containers` directly. */
  activeContainers: MockContainer[];
  workers: MockWorker[];
  startTask: (containerId: string, kind: SectionKind, key: string) => void;
  /** Reverts a running task back to pending — the mistaken-Start undo.
   * Leaves `elapsedSec`/`workerId` untouched; see the implementation
   * comment for why. */
  cancelTask: (containerId: string, kind: SectionKind, key: string) => void;
  stopTask: (containerId: string, kind: SectionKind, key: string) => void;
  markTaskNA: (containerId: string, kind: SectionKind, key: string) => void;
  assignWorker: (containerId: string, kind: SectionKind, key: string, workerId: string) => void;
  /** The quick Today/Tomorrow/+2/+3 reschedule menu in Container Detail.
   * `null` clears the date back to unscheduled. */
  scheduleTask: (containerId: string, kind: SectionKind, key: string, date: string | null) => void;
  /** Pulls a task back off a worker entirely — both `workerId` and
   * `scheduledFor` clear, same as the task had never been assigned. The
   * "remove" action on an already-scheduled row in AssignWorkDialog. */
  unassignTask: (containerId: string, kind: SectionKind, key: string) => void;
  setTaskSite: (containerId: string, kind: SectionKind, key: string, site: SailingSite) => void;
  /** Adds a brand-new task to a container after Gate-In — the one thing the
   * fixed Gate-In builders can't do (sticker removal, office cleaning, an
   * ad-hoc repair flagged from PTI, etc). Awaits the server since it's a
   * real insert, not a patch to something already in local state. */
  addTask: (containerId: string, kind: SectionKind, task: NewTaskInput) => Promise<void>;
  /** A completion photo is required before a container can be marked ready
   * (client request) — the photo URL and readyAt are set together in one
   * call, so there's no in-between state where readyAt is set without one. */
  markReady: (containerId: string, photoUrl: string) => Promise<void>;
  gateIn: (container: MockContainer) => Promise<void>;
  /** Only ever called on a container that's already Ready to move — archives
   * it (sets `departedAt`) so it drops off the active Yard Board/Dashboards/
   * Live Board while staying fully visible in its own report and in Yard
   * Report's Departed panel. */
  gateOut: (containerId: string, entry: GateLogEntry) => Promise<void>;
  updateContainer: (containerId: string, updates: ContainerEdit) => void;
  /** Removes the container record entirely — a mistaken or duplicate entry,
   * not a real-world event like load/offload. No confirmation lives here;
   * the caller (Container Detail) owns that. */
  removeContainer: (containerId: string) => Promise<void>;
  setPriority: (containerId: string, priority: boolean) => void;
  drafts: ContainerDraft[];
  saveDraft: (data: ContainerDraftData) => Promise<void>;
  discardDraft: (draftId: string) => Promise<void>;
  addWorker: (name: string, type: WorkerType, notes: string) => Promise<void>;
  updateWorker: (workerId: string, updates: { name: string; type: WorkerType; notes: string }) => Promise<void>;
  /** Removes the worker and unassigns any task they hadn't started yet.
   * Callers must check they have no *running* task first — this doesn't
   * touch running/done/N-A tasks, so a live timer never silently loses its
   * assignee, and finished work keeps its record of who did it. */
  removeWorker: (workerId: string) => Promise<void>;
  toggleWorkerActive: (workerId: string) => Promise<void>;
  /** Set by `gateIn` or `requestOpen`, so the Yard Board can auto-open a
   * container's drawer even when the request came from another screen — the
   * "New container" action and the command palette both live in the top bar,
   * not on the Yard Board itself. */
  pendingOpenId: string | null;
  requestOpen: (containerId: string) => void;
  clearPendingOpen: () => void;
}

const V2Context = createContext<V2Data | null>(null);

export function V2DataProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  // Starts empty — no mock fallback — and fills in once the real fetch
  // below resolves. Each screen renders its own empty state for that one
  // beat rather than showing placeholder content that isn't real.
  const [containers, setContainers] = useState<MockContainer[]>([]);
  const [workers, setWorkers] = useState<MockWorker[]>([]);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ContainerDraft[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .v2Workers()
      .then(({ workers: fetched }) => {
        if (!cancelled) setWorkers(fetched);
      })
      .catch((err: unknown) => {
        // Worth knowing about, not worth crashing the screen over — the
        // roster just stays empty until the next successful load.
        console.error('Failed to load workers from the server:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .v2Containers()
      .then(({ containers: fetched }) => {
        if (!cancelled) setContainers(fetched);
      })
      .catch((err: unknown) => {
        console.error('Failed to load containers from the server:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .v2Drafts()
      .then(({ drafts: fetched }) => {
        if (!cancelled) setDrafts(fetched);
      })
      .catch((err: unknown) => {
        console.error('Failed to load drafts from the server:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Every task/container field-change below updates local state immediately
  // (so Start/Stop etc. keep feeling instant — these are frequent,
  // latency-sensitive clicks) and separately fires the same change at the
  // server in the background. A failed save is logged, not rolled back —
  // acceptable for this stage; gateIn/removeContainer below are the two
  // actions consequential enough to wait for the server's own confirmation
  // before telling the user it's done.
  const patchTask = (containerId: string, kind: SectionKind, key: string, patch: Partial<Task>): void => {
    api.v2PatchTask(containerId, kind, key, patch).catch((err: unknown) => {
      console.error(`Failed to save task change (${containerId}/${kind}/${key}):`, err);
    });
  };
  const patchContainer = (containerId: string, patch: Parameters<typeof api.v2PatchContainer>[1]): void => {
    api.v2PatchContainer(containerId, patch).catch((err: unknown) => {
      console.error(`Failed to save container change (${containerId}):`, err);
    });
  };

  const value = useMemo<V2Data>(
    () => ({
      containers,
      activeContainers: containers.filter((c) => !c.departedAt),
      workers,
      pendingOpenId,
      requestOpen: (containerId) => setPendingOpenId(containerId),
      clearPendingOpen: () => setPendingOpenId(null),

      startTask: (containerId, kind, key) => {
        const patch = { state: 'running' as const, startedAt: Date.now() };
        setContainers((cur) => mapContainer(cur, containerId, (c) => mapTask(c, kind, key, (t) => ({ ...t, ...patch }))));
        patchTask(containerId, kind, key, patch);
      },

      // Undoes a mistaken Start — back to pending, clock cleared. Doesn't
      // touch `elapsedSec` (so any time banked from an earlier start/stop
      // cycle on this same task is kept, only the current running span is
      // discarded) or `workerId` (per explicit instruction: cancelling the
      // task is a separate action from unassigning its worker — that's done
      // from the worker's own side if that's what's actually needed).
      cancelTask: (containerId, kind, key) => {
        const patch = { state: 'pending' as const, startedAt: null };
        setContainers((cur) => mapContainer(cur, containerId, (c) => mapTask(c, kind, key, (t) => ({ ...t, ...patch }))));
        patchTask(containerId, kind, key, patch);
      },

      stopTask: (containerId, kind, key) => {
        setContainers((cur) =>
          mapContainer(cur, containerId, (c) =>
            mapTask(c, kind, key, (t) => {
              const patch = {
                state: 'done' as const,
                elapsedSec: t.startedAt ? t.elapsedSec + Math.floor((Date.now() - t.startedAt) / 1000) : t.elapsedSec,
                startedAt: null,
                completedAt: new Date().toISOString(),
              };
              patchTask(containerId, kind, key, patch);
              return { ...t, ...patch };
            })
          )
        );
      },

      markTaskNA: (containerId, kind, key) => {
        setContainers((cur) =>
          mapContainer(cur, containerId, (c) =>
            mapTask(c, kind, key, (t) => {
              // Not reachable today — N/A is only offered on a pending task
              // — but fold in elapsed time and clear the timer the same way
              // stopTask does, so this stays correct if that ever changes
              // rather than leaving a stale startedAt behind.
              const patch = {
                state: 'na' as const,
                elapsedSec: t.startedAt ? t.elapsedSec + Math.floor((Date.now() - t.startedAt) / 1000) : t.elapsedSec,
                startedAt: null,
                completedAt: new Date().toISOString(),
              };
              patchTask(containerId, kind, key, patch);
              return { ...t, ...patch };
            })
          )
        );
      },

      assignWorker: (containerId, kind, key, workerId) => {
        setContainers((cur) =>
          mapContainer(cur, containerId, (c) =>
            mapTask(c, kind, key, (t) => {
              const patch = { workerId, scheduledFor: t.scheduledFor ?? todayDate() };
              patchTask(containerId, kind, key, patch);
              return { ...t, ...patch };
            })
          )
        );
      },

      scheduleTask: (containerId, kind, key, date) => {
        const patch = { scheduledFor: date };
        setContainers((cur) => mapContainer(cur, containerId, (c) => mapTask(c, kind, key, (t) => ({ ...t, ...patch }))));
        patchTask(containerId, kind, key, patch);
      },

      unassignTask: (containerId, kind, key) => {
        const patch = { workerId: null, scheduledFor: null };
        setContainers((cur) => mapContainer(cur, containerId, (c) => mapTask(c, kind, key, (t) => ({ ...t, ...patch }))));
        patchTask(containerId, kind, key, patch);
      },

      setTaskSite: (containerId, kind, key, site) => {
        const patch = { site };
        setContainers((cur) => mapContainer(cur, containerId, (c) => mapTask(c, kind, key, (t) => ({ ...t, ...patch }))));
        patchTask(containerId, kind, key, patch);
      },

      addTask: async (containerId, kind, task) => {
        const { container: saved } = await api.v2AddTask(containerId, kind, task);
        setContainers((cur) => mapContainer(cur, containerId, () => saved));
      },

      markReady: async (containerId, photoUrl) => {
        const patch = { readyAt: todayDate(), readyPhotoUrl: photoUrl };
        const { container: saved } = await api.v2PatchContainer(containerId, patch);
        setContainers((cur) => mapContainer(cur, containerId, () => saved));
      },

      gateIn: async (container) => {
        const { container: saved } = await api.v2GateIn(container);
        setContainers((cur) => [saved, ...cur]);
        setPendingOpenId(saved.id);
      },

      gateOut: async (containerId, entry) => {
        const patch = { gateOut: entry, departedAt: entry.loggedAt };
        const { container: saved } = await api.v2PatchContainer(containerId, patch);
        setContainers((cur) => mapContainer(cur, containerId, () => saved));
      },

      updateContainer: (containerId, updates) => {
        setContainers((cur) => mapContainer(cur, containerId, (c) => ({ ...c, ...updates })));
        patchContainer(containerId, updates);
      },

      removeContainer: async (containerId) => {
        await api.v2RemoveContainer(containerId);
        setContainers((cur) => cur.filter((c) => c.id !== containerId));
      },

      setPriority: (containerId, priority) => {
        setContainers((cur) => mapContainer(cur, containerId, (c) => ({ ...c, priority })));
        patchContainer(containerId, { priority });
      },

      drafts,
      saveDraft: async (data) => {
        const id = `draft-${Date.now()}`;
        const savedAt = new Date().toISOString();
        const { draft } = await api.v2SaveDraft(id, savedAt, data);
        setDrafts((cur) => [draft, ...cur]);
      },
      discardDraft: async (draftId) => {
        await api.v2DiscardDraft(draftId);
        setDrafts((cur) => cur.filter((d) => d.id !== draftId));
      },

      addWorker: async (name, type, notes) => {
        const draft: MockWorker = { id: `w-${Date.now()}`, name, type, active: true, notes };
        const { worker } = await api.v2CreateWorker(draft);
        setWorkers((cur) => [worker, ...cur]);
      },

      updateWorker: async (workerId, updates) => {
        const { worker } = await api.v2UpdateWorker(workerId, updates);
        setWorkers((cur) => cur.map((w) => (w.id === workerId ? worker : w)));
      },

      removeWorker: async (workerId) => {
        await api.v2DeleteWorker(workerId);
        setWorkers((cur) => cur.filter((w) => w.id !== workerId));
        setContainers((cur) =>
          cur.map((c) => ({
            ...c,
            sections: c.sections.map((s) => ({
              ...s,
              tasks: s.tasks.map((t) => (t.workerId === workerId && t.state === 'pending' ? { ...t, workerId: null } : t)),
            })),
          }))
        );
      },

      toggleWorkerActive: async (workerId) => {
        const current = workers.find((w) => w.id === workerId);
        if (!current) return;
        const { worker } = await api.v2UpdateWorker(workerId, { active: !current.active });
        setWorkers((cur) => cur.map((w) => (w.id === workerId ? worker : w)));
      },
    }),
    [containers, workers, pendingOpenId, drafts]
  );

  return <V2Context.Provider value={value}>{children}</V2Context.Provider>;
}

export function useV2Data(): V2Data {
  const ctx = useContext(V2Context);
  if (!ctx) throw new Error('useV2Data must be used inside <V2DataProvider>');
  return ctx;
}
