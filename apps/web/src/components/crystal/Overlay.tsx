import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/*
 * Radix owns the behaviour every one of these has to get right: focus trap,
 * focus return to whatever opened it, Escape, scrim click, scroll lock, and
 * aria-modal. The design system owns every pixel. Nothing is restyled here.
 */

/* ------------------------------------------------------------------------ */
/* Modal                                                                     */
/* ------------------------------------------------------------------------ */

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md';
  footer?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim">
          <Dialog.Content className={cx('modal', size === 'sm' && 'sm')} aria-describedby={description ? undefined : undefined}>
            <div className="modal-head">
              <Dialog.Title asChild>
                <h4>{title}</h4>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="iconbtn bare close" aria-label="Close">
                  <Icon name="x" />
                </button>
              </Dialog.Close>
            </div>
            <div className="modal-body">
              {description && (
                <Dialog.Description style={{ marginTop: 0 }}>{description}</Dialog.Description>
              )}
              {children}
            </div>
            {footer && <div className="modal-foot">{footer}</div>}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------------ */
/* Confirmation and destructive dialogs                                       */
/* ------------------------------------------------------------------------ */

/**
 * A destructive dialog names the consequence in the button — "Remove
 * RFCU 445 129-8", never "OK" — and the destructive action never sits where
 * muscle memory expects Save.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  busy?: boolean;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim">
          <Dialog.Content className="modal sm" role={destructive ? 'alertdialog' : 'dialog'}>
            <div className="modal-head">
              {destructive && (
                <span className="warn-mark" aria-hidden="true">
                  <Icon name="alert" />
                </span>
              )}
              <Dialog.Title asChild>
                <h4>{title}</h4>
              </Dialog.Title>
              {!destructive && (
                <Dialog.Close asChild>
                  <button type="button" className="iconbtn bare close" aria-label="Close">
                    <Icon name="x" />
                  </button>
                </Dialog.Close>
              )}
            </div>
            <Dialog.Description asChild>
              <div className="modal-body">{body}</div>
            </Dialog.Description>
            <div className="modal-foot">
              <Dialog.Close asChild>
                <Button variant="ghost">{cancelLabel}</Button>
              </Dialog.Close>
              <Button variant={destructive ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------------ */
/* Drawer                                                                    */
/* ------------------------------------------------------------------------ */

export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  badges,
  footer,
  onCloseAutoFocus,
  wide,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  footer?: React.ReactNode;
  /** For a panel holding a working list rather than a summary. */
  wide?: boolean;
  /**
   * Where focus lands when this closes. Without it the primitive returns focus
   * to its trigger — but a drawer opened from a URL has no trigger, so the
   * caller has to say.
   */
  onCloseAutoFocus?: (event: Event) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-scrim" />
        <Dialog.Content className={cx('drawer', wide && 'wide')} onCloseAutoFocus={onCloseAutoFocus}>
          <div className="modal-head" style={{ borderBottom: '1px solid var(--line)' }}>
            <div style={{ minWidth: 0 }}>
              <Dialog.Title asChild>
                <h4 style={{ margin: 0 }}>{title}</h4>
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-3)',
                    fontFamily: 'var(--f-mono)',
                    margin: 0,
                  }}
                >
                  {subtitle}
                </Dialog.Description>
              )}
              {badges && (
                <div className="cluster" style={{ marginTop: 'var(--s-2)' }}>
                  {badges}
                </div>
              )}
            </div>
            <Dialog.Close asChild>
              <button type="button" className="iconbtn bare close" aria-label="Close panel">
                <Icon name="x" />
              </button>
            </Dialog.Close>
          </div>
          <div style={{ padding: 'var(--s-4)', overflow: 'auto', flex: 1, minHeight: 0 }}>
            {children}
          </div>
          {footer && <div className="modal-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Left-hand navigation sheet — the sidebar below its breakpoint. */
export function NavSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay-scrim" />
        <Dialog.Content className="navdrawer" aria-label={title}>
          <div className="navdrawer-head">
            <Dialog.Title asChild>
              <span className="side-brand" style={{ padding: 0 }}>
                <span className="mark" aria-hidden="true">
                  <i />
                </span>
                {title}
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="iconbtn bare close" aria-label="Close navigation">
                <Icon name="x" />
              </button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------------------ */
/* Menus                                                                     */
/* ------------------------------------------------------------------------ */

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
  label,
  align = 'end',
}: {
  trigger: React.ReactNode;
  items: Array<MenuItem | 'separator' | { heading: string }>;
  label: string;
  align?: 'start' | 'end';
}): React.ReactElement {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild aria-label={label}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dd-menu" align={align} sideOffset={6} collisionPadding={8}>
          {items.map((item, i) => {
            if (item === 'separator') return <DropdownMenu.Separator key={i} className="dd-sep" />;
            if ('heading' in item)
              return (
                <DropdownMenu.Label key={i} className="dd-label">
                  {item.heading}
                </DropdownMenu.Label>
              );
            return (
              <DropdownMenu.Item
                key={i}
                className={cx('dd-item', item.danger && 'danger')}
                onSelect={item.onSelect}
                disabled={item.disabled}
              >
                {item.icon && <Icon name={item.icon} size="sm" />}
                {item.label}
                {item.shortcut && <span className="kbd">{item.shortcut}</span>}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A popover carries a sentence or two. If it only needs a label, use a tooltip. */
export function InfoPopover({
  trigger,
  title,
  children,
}: {
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop-panel" sideOffset={8} collisionPadding={8}>
          <b style={{ fontFamily: 'var(--f-display)', fontSize: '12.5px' }}>{title}</b>
          <p style={{ fontSize: '11.5px', color: 'var(--text-2)', margin: '6px 0 0', lineHeight: 1.55 }}>
            {children}
          </p>
          <Popover.Arrow className="tip-arrow" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
