import { useEffect, useMemo, useState } from 'react';
import { api, type AccessUser, type Screen } from '../../lib/api';
import { WORKER_TYPE_LABELS, WORKER_TYPES, type MockWorker, type WorkerType } from '../../lib/mockV2';
import { NAV_ITEMS } from '../../lib/nav';
import { useV2Data } from '../../lib/v2Store';
import { Button } from '../../components/crystal/Button';
import { CategoryBadge, Person, StatusPill } from '../../components/crystal/Data';
import { CheckboxField, Field } from '../../components/crystal/Form';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { ConfirmDialog, Modal } from '../../components/crystal/Overlay';

// The six real screens, with the exact labels the sidebar itself uses — one
// source (nav.ts), so a checkbox here can never say something the sidebar
// disagrees with.
const SCREEN_OPTIONS: Array<{ screen: Screen; label: string }> = NAV_ITEMS.filter(
  (item): item is typeof item & { screen: Screen } => Boolean(item.screen)
).map((item) => ({ screen: item.screen, label: item.label }));

interface Draft {
  // 'new' adds a worker and a login together; an existing worker's id edits
  // or creates just the login for them.
  workerId: string | 'new';
  newWorkerName: string;
  newWorkerType: WorkerType;
  email: string;
  password: string;
  allowedScreens: Set<Screen>;
}

function emptyDraft(workerId: string | 'new' = 'new'): Draft {
  return { workerId, newWorkerName: '', newWorkerType: 'painter', email: '', password: '', allowedScreens: new Set() };
}

export function AccessManagement(): React.ReactElement {
  const { workers, addWorker } = useV2Data();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AccessUser | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const loadUsers = (): void => {
    api
      .v2Users()
      .then(({ users: fetched }) => setUsers(fetched))
      .catch((err: unknown) => console.error('Failed to load access list:', err))
      .finally(() => setLoading(false));
  };

  useEffect(loadUsers, []);

  const userByWorkerId = useMemo(() => new Map(users.filter((u) => u.workerId).map((u) => [u.workerId as string, u])), [users]);

  const openForWorker = (workerId: string): void => {
    const existing = userByWorkerId.get(workerId);
    const d = emptyDraft(workerId);
    if (existing) {
      d.email = existing.email;
      d.allowedScreens = new Set(existing.allowedScreens);
    }
    setDraft(d);
  };

  const toggleScreen = (screen: Screen): void => {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.allowedScreens);
      if (next.has(screen)) next.delete(screen);
      else next.add(screen);
      return { ...d, allowedScreens: next };
    });
  };

  const handleSave = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      let workerId = draft.workerId;
      let workerName = workers.find((w) => w.id === workerId)?.name ?? '';

      if (workerId === 'new') {
        if (!draft.newWorkerName.trim()) return;
        const worker: MockWorker = await addWorker(draft.newWorkerName.trim(), draft.newWorkerType, '');
        workerId = worker.id;
        workerName = worker.name;
      }

      const existing = userByWorkerId.get(workerId);
      if (existing) {
        const { user } = await api.v2UpdateUser(existing.id, {
          allowedScreens: [...draft.allowedScreens],
          ...(draft.password.trim() && { password: draft.password.trim() }),
        });
        setUsers((cur) => cur.map((u) => (u.id === user.id ? user : u)));
        toast.ok('Access updated', `${workerName}'s access was saved.`);
      } else {
        if (!draft.email.trim() || draft.password.trim().length < 6) {
          toast.error('Could not give access', 'Enter an email and a password of at least 6 characters.');
          return;
        }
        const { user } = await api.v2CreateUser({
          id: `u-${workerId}`,
          email: draft.email.trim(),
          password: draft.password.trim(),
          name: workerName,
          role: 'technician',
          workerId,
          allowedScreens: [...draft.allowedScreens],
        });
        setUsers((cur) => [...cur, user]);
        toast.ok('Access given', `${workerName} can now sign in.`);
      }
      setDraft(null);
    } catch (err) {
      toast.error('Could not save this', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!removeTarget) return;
    try {
      await api.v2DeleteUser(removeTarget.id);
      setUsers((cur) => cur.filter((u) => u.id !== removeTarget.id));
      toast.ok('Access removed', `${removeTarget.name} can no longer sign in.`);
    } catch {
      toast.error('Could not remove access', 'Try again.');
    } finally {
      setRemoveTarget(null);
    }
  };

  const editingWorkerName = draft && draft.workerId !== 'new' ? workers.find((w) => w.id === draft.workerId)?.name : null;
  const isEditingExisting = Boolean(draft && draft.workerId !== 'new' && userByWorkerId.has(draft.workerId));

  return (
    <div className="stack stack-loose">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <p className="subtle" style={{ margin: 0, maxWidth: '640px', fontSize: '12.5px' }}>
          Give a worker a login, and choose exactly which screens they can reach. A worker with no login here simply
          can't sign in — this is separate from their roster entry.
        </p>
        <Button variant="accent" size="sm" icon="plus" onClick={() => setDraft(emptyDraft('new'))}>
          New worker with access
        </Button>
      </div>

      {loading ? (
        <EmptyState icon="shield" title="Loading access list…">
          One moment.
        </EmptyState>
      ) : workers.length === 0 ? (
        <EmptyState icon="shield" title="No workers yet">
          Add one from here or from Worker Roster first.
        </EmptyState>
      ) : (
        <div className="stack stack-tight">
          {workers.map((w) => {
            const u = userByWorkerId.get(w.id);
            return (
              <div key={w.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
                <span className="cluster" style={{ gap: 'var(--s-3)' }}>
                  <Person name={w.name} detail={WORKER_TYPE_LABELS[w.type]} />
                  {u ? (
                    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                      <StatusPill status={{ tone: 'ok', icon: 'check-circle', label: u.email, detail: `Can sign in as ${u.email}.` }} />
                      {u.allowedScreens.length === 0 ? (
                        <span className="subtle" style={{ fontSize: '12px' }}>No screens granted yet</span>
                      ) : (
                        u.allowedScreens.map((s) => (
                          <CategoryBadge key={s}>{SCREEN_OPTIONS.find((o) => o.screen === s)?.label ?? s}</CategoryBadge>
                        ))
                      )}
                    </span>
                  ) : (
                    <StatusPill status={{ tone: 'neutral', icon: 'x-circle', label: 'No login', detail: `${w.name} has no way to sign in.` }} />
                  )}
                </span>
                <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => openForWorker(w.id)}>
                    {u ? 'Edit access' : 'Give access'}
                  </Button>
                  {u && (
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoveTarget(u)}>
                      Remove
                    </Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={draft?.workerId === 'new' ? 'New worker with access' : isEditingExisting ? `Edit access — ${editingWorkerName}` : `Give access — ${editingWorkerName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" onClick={() => void handleSave()} loading={saving} disabled={saving}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="stack">
            {draft.workerId === 'new' && (
              <>
                <Field label="Worker name" required>
                  {(props) => (
                    <input {...props} value={draft.newWorkerName} onChange={(e) => setDraft((d) => d && { ...d, newWorkerName: e.target.value })} placeholder="Full name" autoComplete="off" />
                  )}
                </Field>
                <Field label="Type" required>
                  {(props) => (
                    <select {...props} value={draft.newWorkerType} onChange={(e) => setDraft((d) => d && { ...d, newWorkerType: e.target.value as WorkerType })}>
                      {WORKER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {WORKER_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </>
            )}
            {!isEditingExisting && (
              <Field label="Email" required hint="This is their username.">
                {(props) => <input {...props} type="email" value={draft.email} onChange={(e) => setDraft((d) => d && { ...d, email: e.target.value })} placeholder="name@example.com" autoComplete="off" />}
              </Field>
            )}
            <Field label="Password" required={!isEditingExisting} hint={isEditingExisting ? 'Leave blank to keep their current password.' : 'At least 6 characters.'}>
              {(props) => <input {...props} type="password" value={draft.password} onChange={(e) => setDraft((d) => d && { ...d, password: e.target.value })} placeholder={isEditingExisting ? '••••••••' : 'Set a password'} autoComplete="new-password" />}
            </Field>
            <div className="field" role="group" aria-label="Screens they can reach">
              <span aria-hidden="true">Screens they can reach</span>
              <div className="stack stack-tight" style={{ marginTop: 'var(--s-2)' }}>
                {SCREEN_OPTIONS.map(({ screen, label }) => (
                  <CheckboxField key={screen} checked={draft.allowedScreens.has(screen)} onCheckedChange={() => toggleScreen(screen)} label={label} />
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(next) => !next && setRemoveTarget(null)}
        title="Remove access?"
        body={removeTarget ? `${removeTarget.name} will no longer be able to sign in. Their worker roster entry stays untouched.` : ''}
        confirmLabel="Remove access"
        destructive
        onConfirm={() => void handleRemove()}
      />
    </div>
  );
}
