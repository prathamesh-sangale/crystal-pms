import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { NAV, navItemFor } from '../../lib/nav';
import { useOverview } from '../../lib/queries';
import { useTheme } from '../../lib/theme';
import { Button, IconButton } from '../crystal/Button';
import { Avatar } from '../crystal/Data';
import { Icon } from '../crystal/Icon';
import { Menu, NavSheet } from '../crystal/Overlay';
import { AddContainerDialog } from './AddContainerDialog';
import { CommandPalette } from './CommandPalette';
import { ContainerDrawer } from './ContainerDrawer';

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
  const { pathname } = useLocation();
  const { user, signOut, can } = useAuth();
  const { theme, toggle } = useTheme();
  const { data: overview } = useOverview();
  const current = navItemFor(pathname);

  const navItems = (onNavigate?: () => void): React.ReactNode =>
    NAV.map((group) => (
      <div key={group.heading}>
        <div className="side-group">{group.heading}</div>
        {group.items.map((item) => {
          const tally = overview && item.tally ? item.tally(overview) : null;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) => cx('navitem', isActive && 'on')}
            >
              <Icon name={item.icon} size="sm" />
              {item.label}
              {tally !== null && tally !== undefined && (
                <span className="tally">
                  {tally}
                  <span className="sr-only"> {item.label.toLowerCase()} needing attention</span>
                </span>
              )}
            </NavLink>
          );
        })}
      </div>
    ));

  return (
    <div className="appshell">
      <a className="btn btn-primary btn-sm skiplink" href="#main">
        Skip to content
      </a>

      <aside className="side" aria-label="Sections">
        <div className="side-brand">
          <span className="mark" aria-hidden="true">
            <i />
          </span>
          ReeferReady
        </div>
        <nav>{navItems()}</nav>
        <div className="side-foot">
          <Avatar name={user?.name ?? '—'} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div
              className="truncate"
              style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px' }}
            >
              {user?.name}
            </div>
            <div className="truncate" style={{ fontSize: '10px', color: 'var(--text-3)' }}>
              {user?.role}
            </div>
          </div>
        </div>
      </aside>

      <NavSheet open={navOpen} onOpenChange={setNavOpen} title="ReeferReady">
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
              {current?.title ?? 'ReeferReady'}
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
              { label: `Signed in as ${user?.role}`, icon: 'user', onSelect: () => {}, disabled: true },
              'separator',
              { label: 'Sign out', icon: 'power', onSelect: signOut, danger: true },
            ]}
          />

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
                <p>{current.description}</p>
              </div>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <AddContainerDialog open={addOpen} onOpenChange={setAddOpen} />
      <ContainerDrawer />
    </div>
  );
}
