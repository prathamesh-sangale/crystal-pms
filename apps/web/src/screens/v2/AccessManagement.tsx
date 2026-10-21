import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { api, type AccessUser, type Screen } from '../../lib/api';
import { roleDisplayLabel } from '../../lib/auth';
import { WORKER_TYPE_LABELS, WORKER_TYPES, type MockWorker, type WorkerType } from '../../lib/mockV2';
import { NAV_ITEMS } from '../../lib/nav';
import { useV2Data } from '../../lib/v2Store';
import { Button, Segmented } from '../../components/crystal/Button';
import { CategoryBadge, Person, StatusPill } from '../../components/crystal/Data';
import { DataTable } from '../../components/crystal/DataTable';
import { CheckboxField, Field } from '../../components/crystal/Form';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { ConfirmDialog, Modal } from '../../components/crystal/Overlay';

const columnHelper = createColumnHelper<AccessUser>();

// The six real screens, with the exact labels the sidebar itself uses — one
// source (nav.ts), so a checkbox here can never say something the sidebar
// disagrees with.
const SCREEN_OPTIONS: Array<{ screen: Screen; label: string }> = NAV_ITEMS.filter(
  (item): item is typeof item & { screen: Screen } => Boolean(item.screen)
).map((item) => ({ screen: item.screen, label: item.label }));

const ROLE_OPTIONS: Array<{ value: AccessUser['role']; label: string }> = [
  { value: 'manager', label: 'Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'technician', label: 'Technician' },
  { value: 'viewer', label: 'Viewer' },
];

type DisplayMode = 'cards' | 'list';

/** A login not reachable from any worker name (so it won't collide with the
 * `u-${workerId}` ids the worker-linked flow already uses), short enough to
 * read back. Uniqueness isn't load-bearing here — the server's own email
 * uniqueness constraint is the real guard; this just keeps ids tidy. */
function standaloneLoginId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
  return `u-${slug}-${Date.now().toString(36)}`;
}

type DraftKind = 'new-worker' | 'new-login' | 'edit';

interface Draft {
  kind: DraftKind;
  userId: string | null;
  /** The worker this login is (or will be) linked to, if any — set for
   * 'new-worker' once the worker's created, or pre-filled for 'edit' when
   * the existing login already has one. Never set for 'new-login': a
   * standalone login is the whole point of that path. */
  workerId: string | null;
  newWorkerName: string;
  newWorkerType: WorkerType;
  /** The login's own name — only meaningful (and shown) for a standalone
   * login; a worker-linked login always displays the worker's own name. */
  name: string;
  email: string;
  password: string;
  role: AccessUser['role'];
  allowedScreens: Set<Screen>;
}

function emptyDraft(kind: DraftKind, workerId: string | null = null): Draft {
  return {
    kind,
    userId: null,
    workerId,
    newWorkerName: '',
    newWorkerType: 'painter',
    name: '',
    email: '',
    password: '',
    role: 'technician',
    allowedScreens: new Set(),
  };
}

export function AccessManagement(): React.ReactElement {
  const { workers, addWorker } = useV2Data();
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
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

  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const workerIdsWithLogin = useMemo(() => new Set(users.filter((u) => u.workerId).map((u) => u.workerId as string)), [users]);
  const workersWithoutLogin = useMemo(() => workers.filter((w) => !workerIdsWithLogin.has(w.id)), [workers, workerIdsWithLogin]);

  const displayName = (u: AccessUser): string => (u.workerId && workerById.get(u.workerId)?.name) || u.name;

  const openGiveAccess = (workerId: string): void => {
    setDraft(emptyDraft('new-worker', workerId));
  };

  const openEdit = (u: AccessUser): void => {
    setDraft({
      kind: 'edit',
      userId: u.id,
      workerId: u.workerId,
      newWorkerName: '',
      newWorkerType: 'painter',
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      allowedScreens: new Set(u.allowedScreens),
    });
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

    // Validate everything the request will need *before* creating anything
    // server-side — a brand-new worker is a real, permanent row the moment
    // addWorker resolves, and there's no rollback if a later step fails. Doing
    // this up front means a bad email/password never leaves an orphaned,
    // duplicate-on-retry worker behind.
    if (draft.kind === 'new-worker' && !draft.workerId && !draft.newWorkerName.trim()) {
      toast.error('Could not give access', 'Enter a worker name.');
      return;
    }
    if (draft.kind === 'new-login' && !draft.name.trim()) {
      toast.error('Could not create login', 'Enter a name.');
      return;
    }
    if (draft.kind !== 'edit' && (!draft.email.trim() || draft.password.trim().length < 8)) {
      toast.error('Could not save', 'Enter an email and a password of at least 8 characters.');
      return;
    }

    setSaving(true);
    try {
      if (draft.kind === 'edit') {
        if (!draft.userId) return;
        const { user } = await api.v2UpdateUser(draft.userId, {
          role: draft.role,
          allowedScreens: [...draft.allowedScreens],
          ...(draft.password.trim() && { password: draft.password.trim() }),
        });
        setUsers((cur) => cur.map((u) => (u.id === user.id ? user : u)));
        toast.ok('Access updated', `${displayName(user)}'s access was saved.`);
      } else if (draft.kind === 'new-worker') {
        let workerId = draft.workerId;
        let workerName = workerId ? (workerById.get(workerId)?.name ?? '') : '';

        if (!workerId) {
          const worker: MockWorker = await addWorker(draft.newWorkerName.trim(), draft.newWorkerType, '');
          workerId = worker.id;
          workerName = worker.name;
          // The dialog was showing "New worker with access" against draft state
          // that no longer matches reality now that the worker is real — if
          // anything below throws, re-point the draft at the real id so a retry
          // edits this worker's login instead of creating another one.
          setDraft((d) => (d ? { ...d, kind: 'new-worker', workerId } : d));
        }

        const { user } = await api.v2CreateUser({
          id: `u-${workerId}`,
          email: draft.email.trim(),
          password: draft.password.trim(),
          name: workerName,
          role: draft.role,
          workerId,
          allowedScreens: [...draft.allowedScreens],
        });
        setUsers((cur) => [...cur, user]);
        toast.ok('Access given', `${workerName} can now sign in.`);
      } else {
        // 'new-login' -- a login with no worker roster entry at all (someone
        // who assigns/oversees work rather than doing it themselves).
        const name = draft.name.trim();
        const { user } = await api.v2CreateUser({
          id: standaloneLoginId(name),
          email: draft.email.trim(),
          password: draft.password.trim(),
          name,
          role: draft.role,
          workerId: null,
          allowedScreens: [...draft.allowedScreens],
        });
        setUsers((cur) => [...cur, user]);
        toast.ok('Access given', `${name} can now sign in.`);
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
      toast.ok('Access removed', `${displayName(removeTarget)} can no longer sign in.`);
    } catch {
      toast.error('Could not remove access', 'Try again.');
    } finally {
      setRemoveTarget(null);
    }
  };

  const dialogTitle = !draft
    ? ''
    : draft.kind === 'edit'
      ? `Edit access — ${(draft.workerId && workerById.get(draft.workerId)?.name) || draft.name}`
      : draft.kind === 'new-worker' && draft.workerId
        ? `Give access — ${workerById.get(draft.workerId)?.name ?? ''}`
        : draft.kind === 'new-worker'
          ? 'New worker with access'
          : 'New login';

  const columns = useMemo(
    () => [
      columnHelper.accessor((u) => (u.workerId && workerById.get(u.workerId)?.name) || u.name, {
        id: 'name',
        header: 'Name',
        meta: { label: 'Name', lead: true },
        cell: (ctx) => {
          const u = ctx.row.original;
          const worker = u.workerId ? workerById.get(u.workerId) : null;
          return <Person name={ctx.getValue()} detail={worker ? `${roleDisplayLabel(u.role)} · ${WORKER_TYPE_LABELS[worker.type]}` : roleDisplayLabel(u.role)} />;
        },
      }),
      columnHelper.accessor('email', {
        header: 'Email',
        meta: { label: 'Email' },
        cell: (ctx) => <span className="mono" style={{ fontSize: '12px' }}>{ctx.getValue()}</span>,
      }),
      columnHelper.display({
        id: 'screens',
        header: 'Access',
        meta: { label: 'Access', secondary: true },
        cell: (ctx) => {
          const screens = ctx.row.original.allowedScreens;
          return screens.length === 0 ? (
            <span className="subtle" style={{ fontSize: '12px' }}>No screens granted yet</span>
          ) : (
            <span className="cluster" style={{ gap: 'var(--s-1)' }}>
              {screens.map((s) => (
                <CategoryBadge key={s}>{SCREEN_OPTIONS.find((o) => o.screen === s)?.label ?? s}</CategoryBadge>
              ))}
            </span>
          );
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Actions',
        meta: { label: 'Actions' },
        cell: (ctx) => (
          <span className="cluster" style={{ gap: 'var(--s-2)' }}>
            <Button variant="secondary" size="sm" icon="edit" onClick={() => openEdit(ctx.row.original)}>
              Edit access
            </Button>
            <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoveTarget(ctx.row.original)}>
              Remove
            </Button>
          </span>
        ),
      }),
    ],
    [workerById]
  );

  return (
    <div className="stack stack-loose">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <p className="subtle" style={{ margin: 0, maxWidth: '640px', fontSize: '12.5px' }}>
          Everyone who can currently sign in — a worker's own login, or a standalone one for someone who doesn't do
          roster work themselves. Change anyone's screens, role, or password from here at any time.
        </p>
        <span className="cluster" style={{ gap: 'var(--s-2)' }}>
          <Button variant="secondary" size="sm" icon="plus" onClick={() => setDraft(emptyDraft('new-login'))}>
            New login
          </Button>
          <Button variant="accent" size="sm" icon="plus" onClick={() => setDraft(emptyDraft('new-worker'))}>
            New worker with access
          </Button>
          <Segmented
            value={displayMode}
            onChange={setDisplayMode}
            label="Display as"
            options={[
              { value: 'cards', label: 'Cards' },
              { value: 'list', label: 'List' },
            ]}
          />
        </span>
      </div>

      {loading ? (
        <EmptyState icon="shield" title="Loading access list…">
          One moment.
        </EmptyState>
      ) : users.length === 0 ? (
        <EmptyState icon="shield" title="No one has access yet">
          Use New login or New worker with access above.
        </EmptyState>
      ) : displayMode === 'list' ? (
        <DataTable
          data={users}
          columns={columns}
          getRowId={(u) => u.id}
          caption="Everyone who can sign in"
          pageSize={10}
          rowLabel={(u) => displayName(u)}
          empty={<EmptyState icon="shield" title="No one has access yet">Use New login or New worker with access above.</EmptyState>}
        />
      ) : (
        <div style={{ columnWidth: '300px', columnGap: 'var(--s-4)' }}>
          {users.map((u) => {
            const worker = u.workerId ? workerById.get(u.workerId) : null;
            return (
              <div key={u.id} className="card" style={{ breakInside: 'avoid', marginBottom: 'var(--s-4)' }}>
                <div className="stack">
                  <div className="cluster" style={{ justifyContent: 'space-between' }}>
                    <Person name={displayName(u)} detail={worker ? `${roleDisplayLabel(u.role)} · ${WORKER_TYPE_LABELS[worker.type]}` : roleDisplayLabel(u.role)} />
                  </div>
                  <StatusPill status={{ tone: 'ok', icon: 'check-circle', label: u.email, detail: `Can sign in as ${u.email}.` }} />
                  {u.allowedScreens.length === 0 ? (
                    <span className="subtle" style={{ fontSize: '12px' }}>No screens granted yet</span>
                  ) : (
                    <span className="cluster" style={{ gap: 'var(--s-1)', flexWrap: 'wrap' }}>
                      {u.allowedScreens.map((s) => (
                        <CategoryBadge key={s}>{SCREEN_OPTIONS.find((o) => o.screen === s)?.label ?? s}</CategoryBadge>
                      ))}
                    </span>
                  )}
                  <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                    <Button variant="secondary" size="sm" icon="edit" onClick={() => openEdit(u)}>
                      Edit access
                    </Button>
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => setRemoveTarget(u)}>
                      Remove
                    </Button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {workersWithoutLogin.length > 0 && (
        <div className="stack stack-tight">
          <span className="subtle" style={{ fontSize: '12px' }}>
            On the roster, no login yet
          </span>
          {workersWithoutLogin.map((w) => (
            <div key={w.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s-3)' }}>
              <Person name={w.name} detail={WORKER_TYPE_LABELS[w.type]} />
              <Button variant="secondary" size="sm" icon="plus" onClick={() => openGiveAccess(w.id)}>
                Give access
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={draft !== null}
        onOpenChange={(next) => !next && setDraft(null)}
        title={dialogTitle}
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
            {draft.kind === 'new-worker' && !draft.workerId && (
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
            {draft.kind === 'new-login' && (
              <Field label="Name" required>
                {(props) => <input {...props} value={draft.name} onChange={(e) => setDraft((d) => d && { ...d, name: e.target.value })} placeholder="Full name" autoComplete="off" />}
              </Field>
            )}
            {draft.kind !== 'edit' && (
              <Field label="Email" required hint="This is their username.">
                {(props) => <input {...props} type="email" value={draft.email} onChange={(e) => setDraft((d) => d && { ...d, email: e.target.value })} placeholder="name@example.com" autoComplete="off" />}
              </Field>
            )}
            <Field label="Role" required>
              {(props) => (
                <select {...props} value={draft.role} onChange={(e) => setDraft((d) => d && { ...d, role: e.target.value as AccessUser['role'] })}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Password" required={draft.kind === 'edit' ? false : true} hint={draft.kind === 'edit' ? 'Leave blank to keep their current password.' : 'At least 8 characters.'}>
              {(props) => <input {...props} type="password" value={draft.password} onChange={(e) => setDraft((d) => d && { ...d, password: e.target.value })} placeholder={draft.kind === 'edit' ? '••••••••' : 'Set a password'} autoComplete="new-password" />}
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
        body={removeTarget ? `${displayName(removeTarget)} will no longer be able to sign in.${removeTarget.workerId ? ' Their worker roster entry stays untouched.' : ''}` : ''}
        confirmLabel="Remove access"
        destructive
        onConfirm={() => void handleRemove()}
      />
    </div>
  );
}
