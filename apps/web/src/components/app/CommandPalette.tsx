import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../../lib/nav';
import { useTheme } from '../../lib/theme';
import { useV2Data } from '../../lib/v2Store';
import { Icon } from '../crystal/Icon';

/**
 * The power-user path. Every action here also exists somewhere in the UI —
 * the palette is a shortcut, never the only route to something.
 */
export function CommandPalette(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { containers, requestOpen } = useV2Data();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const run = (fn: () => void): void => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Icon name="search" size="sm" />
        <span className="hide-sm">Search</span>
        <kbd className="kbd hide-sm">⌘K</kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        // This becomes the input's accessible name: the primitive renders a
        // hidden <label> and points aria-labelledby at it, which takes
        // precedence over any aria-label we could add ourselves.
        label="Search containers, screens and actions"
        overlayClassName="cmdk-scrim"
        contentClassName="cmdk"
        shouldFilter
      >
        <div className="cmdk-search">
          <Icon name="search" />
          <Command.Input placeholder="Search containers, screens and actions…" />
          <kbd className="kbd">ESC</kbd>
        </div>

        <Command.List className="cmdk-list">
          <Command.Empty className="ac-none">
            Nothing matches that. Try a unit number or “live board”.
          </Command.Empty>

          <Command.Group heading="Go to">
            {NAV_ITEMS.map((item) => (
              <Command.Item
                key={item.to}
                className="cmdk-item"
                value={`${item.label} ${item.description}`}
                onSelect={() => run(() => navigate(item.to))}
              >
                <Icon name={item.icon} size="sm" />
                {item.label}
                <span className="kbd">go</span>
              </Command.Item>
            ))}
          </Command.Group>

          {containers.length > 0 && (
            <Command.Group heading="Containers">
              {containers.map((container) => (
                <Command.Item
                  key={container.id}
                  className="cmdk-item"
                  value={`${container.id} ${container.typeCode}`}
                  onSelect={() =>
                    run(() => {
                      // A departed container no longer shows on the Yard
                      // Board, so opening its drawer there would be a dead
                      // end — its report is the one place it's still fully
                      // visible.
                      if (container.departedAt) {
                        navigate(`/containers/${encodeURIComponent(container.id)}/report`);
                      } else {
                        requestOpen(container.id);
                        navigate('/yard');
                      }
                    })
                  }
                >
                  <Icon name="container" size="sm" />
                  <span className="mono">{container.id}</span>
                  <span className="subtle truncate">{container.typeCode}</span>
                  {container.departedAt ? <span className="subtle">Departed</span> : null}
                  <span className="kbd">{container.departedAt ? 'report' : 'open'}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Actions">
            <Command.Item
              className="cmdk-item"
              value="toggle theme dark light appearance"
              onSelect={() => run(toggle)}
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
              Switch to the {theme === 'dark' ? 'light' : 'dark'} theme
              <span className="kbd">run</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        <div className="cmdk-foot">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </Command.Dialog>
    </>
  );
}
