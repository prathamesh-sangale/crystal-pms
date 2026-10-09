import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RequestError } from '../../lib/api';
import { roleDisplayLabel, useAuth } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { ADMIN_ACCOUNT, DEV_PASSWORD } from '../../lib/devAccounts';
import type { MockContainer } from '../../lib/mockV2';
import { NAV, navItemFor } from '../../lib/nav';
import { useTheme } from '../../lib/theme';
import { useV2Data } from '../../lib/v2Store';
import { Button, IconButton } from '../crystal/Button';
import { Avatar } from '../crystal/Data';
import { useToast } from '../crystal/Feedback';
import { Icon } from '../crystal/Icon';
import { ConfirmDialog, Menu, type MenuItem, NavSheet } from '../crystal/Overlay';
import { GateFormDialog } from '../v2/GateFormDialog';
import { CommandPalette } from './CommandPalette';

/**
 * The frame.
 *
 * White sidebar with a lightly tinted active item — never a solid navy panel
 * (rule 5). Exactly one accent button in the top bar (rule 13). Below 1024px
 * the rail is replaced by a sheet rather than disappearing, which is what the
 * concept did.
 */
export function AppShell(): React.ReactElement {
  const [navOpen, setNavOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [draftToDelete, setDraftToDelete] = useState<string | null>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, signIn, signOut, can } = useAuth();
  const { theme, toggle } = useTheme();
  const { containers, gateIn, drafts, saveDraft, discardDraft } = useV2Data();
  const toast = useToast();
  const current = navItemFor(pathname);
  const resumeDraft = drafts.find((d) => d.id === resumeDraftId) ?? null;

  const handleGateIn = async (container: MockContainer): Promise<void> => {
    // Awaited rather than fire-and-forget: gateIn now actually saves to the
    // server, so the success toast and navigation have to wait for that to
    // really happen — showing them first (the old behavior) would claim
    // success a beat before the save was confirmed, or even if it failed.
    await gateIn(container);
    toast.ok('Container registered', `${container.id} ${container.sections.length ? `has ${container.sections.length} section(s) open.` : 'is ready to move.'}`);
    if (pathname !== '/yard') navigate('/yard');
  };

  // Dev-only: one account runs the app now (SPEC.md). If a tester signed in
  // as one of the other seeded roles by typing credentials — those still
  // work, just aren't offered as a shortcut anywhere — this is the fast way
  // back to Admin, without a sign-out/retype round trip. Still a real
  // signIn() call, not a bypass.
  const switchTo = async (email: string): Promise<void> => {
    try {
      await signIn(email, DEV_PASSWORD);
    } catch (error) {
      toast.error(
        'Could not switch user',
        error instanceof RequestError ? error.message : 'Try again.'
      );
    }
  };

  const switchSection: Array<MenuItem | 'separator' | { heading: string }> =
    import.meta.env.DEV && user?.email !== ADMIN_ACCOUNT.email
      ? [
          'separator',
          {
            label: 'Back to Admin · dev only',
            icon: 'user' as const,
            onSelect: () => void switchTo(ADMIN_ACCOUNT.email),
          },
        ]
      : [];

  const navItems = (onNavigate?: () => void): React.ReactNode =>
    NAV.map((group) => (
      <div key={group.heading}>
        <div className="side-group">{group.heading}</div>
        {group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) => cx('navitem', isActive && 'on')}
          >
            <Icon name={item.icon} size="sm" />
            {/* Faded rather than removed when collapsed, so the item keeps
                its accessible name at every width. */}
            <span className="navitem-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    ));

  return (
    <div className="appshell">
      <a className="btn btn-primary btn-sm skiplink" href="#main">
        Skip to content
      </a>

      {/* The slot holds the collapsed width; the rail floats above the content
          when it expands, so hovering it never reflows the page. */}
      <div className="rail-slot">
        <aside className="side rail" aria-label="Sections">
          <div className="side-brand">
            <span className="mark" aria-hidden="true">
              <i />
            </span>
            <span className="side-brand-label">Crystal PMS</span>
          </div>
          <nav>{navItems()}</nav>
          <div className="side-foot">
            <Avatar name={user?.name ?? '—'} size="sm" />
            <div className="side-foot-label" style={{ minWidth: 0 }}>
              <div
                className="truncate"
                style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px' }}
              >
                {user?.name}
              </div>
              <div className="truncate" style={{ fontSize: '10px', color: 'var(--text-3)' }}>
                {user && roleDisplayLabel(user.role)}
              </div>
            </div>
          </div>
        </aside>
      </div>

      <NavSheet open={navOpen} onOpenChange={setNavOpen} title="Crystal PMS">
        <nav>{navItems(() => setNavOpen(false))}</nav>
      </NavSheet>

      <div className="appmain">
        <header className="appbar">
          <span className="navtoggle">
            <IconButton icon="list" label="Open navigation" bare onClick={() => setNavOpen(true)} />
          </span>

          <div className="grow">
            <div
              className="truncate"
              style={{ fontFamily: 'var(--f-display)', fontWeight: 800, fontSize: '13px' }}
            >
              {current?.title ?? 'Crystal PMS'}
            </div>
          </div>

          <CommandPalette />

          <IconButton
            icon={theme === 'dark' ? 'sun' : 'moon'}
            label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            bare
            onClick={toggle}
          />

          <Menu
            label="Account"
            trigger={
              <button type="button" className="iconbtn bare" aria-label="Account">
                <Avatar name={user?.name ?? '—'} size="sm" />
              </button>
            }
            items={[
              { heading: user?.email ?? '' },
              { label: `Signed in as ${user ? roleDisplayLabel(user.role) : ''}`, icon: 'user', onSelect: () => {}, disabled: true },
              ...switchSection,
              'separator',
              { label: 'Sign out', icon: 'power', onSelect: signOut, danger: true },
            ]}
          />

          {can('container:create') && drafts.length > 0 && (
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button variant="secondary" size="sm" icon="doc">
                  Drafts ({drafts.length})
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="pop-panel" style={{ width: '280px', padding: 'var(--s-2)' }} sideOffset={6} collisionPadding={8} align="end">
                  <div className="stack stack-tight">
                    {drafts.map((d) => (
                      <div key={d.id} className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-1)' }}>
                        <button
                          type="button"
                          onClick={() => {
                            setResumeDraftId(d.id);
                            setAddOpen(true);
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            textAlign: 'left',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 'var(--s-2)',
                            borderRadius: 'var(--r-sm)',
                          }}
                        >
                          <span className="truncate" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>
                            {d.data.id || 'Untitled'}
                          </span>
                          <span className="truncate" style={{ display: 'block', fontSize: '11px', color: 'var(--text-3)' }}>
                            {d.data.typeCode}
                          </span>
                        </button>
                        <IconButton
                          icon="trash"
                          label={`Delete draft ${d.data.id || 'Untitled'}`}
                          size="sm"
                          bare
                          onClick={() => setDraftToDelete(d.id)}
                        />
                      </div>
                    ))}
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}

          {/* Exactly one accent action in the bar. */}
          {can('container:create') && (
            <Button variant="accent" size="sm" icon="plus" onClick={() => setAddOpen(true)}>
              New container
            </Button>
          )}
        </header>

        {/* Keyed on the route so the entrance replays on every navigation —
            220ms, ease-out, 6px. Enough to say "this is new", not enough to
            wait for. Collapses to nothing under prefers-reduced-motion. */}
        <main className="appcontent rise-in" id="main" tabIndex={-1} key={pathname}>
          {current && (
            <div className="pagehead">
              <div className="pagehead-text">
                <h1>{current.title}</h1>
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <GateFormDialog
        mode="in"
        open={addOpen}
        onOpenChange={(next) => {
          setAddOpen(next);
          if (!next) setResumeDraftId(null);
        }}
        onGateIn={handleGateIn}
        existingIds={containers.map((c) => c.id)}
        resumeDraft={resumeDraft}
        onSaveDraft={saveDraft}
        onDiscardDraft={discardDraft}
        loggedInEmail={user?.email}
      />

      <ConfirmDialog
        open={Boolean(draftToDelete)}
        onOpenChange={(next) => {
          if (!next) setDraftToDelete(null);
        }}
        title="Delete draft"
        body="This draft will be removed and can't be recovered."
        confirmLabel="Delete draft"
        destructive
        onConfirm={() => {
          if (draftToDelete) discardDraft(draftToDelete);
          setDraftToDelete(null);
        }}
      />
    </div>
  );
}
