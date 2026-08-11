import * as Toast from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/* ------------------------------------------------------------------------ */
/* Alerts — the condition is still true, so the message stays on the page     */
/* ------------------------------------------------------------------------ */

type AlertTone = 'ok' | 'err' | 'warn' | 'info';

const ALERT_ICON: Record<AlertTone, IconName> = {
  ok: 'check-circle',
  err: 'breach',
  warn: 'alert',
  info: 'info',
};

export function Alert({
  tone = 'info',
  title,
  children,
  onDismiss,
}: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
  onDismiss?: () => void;
}): React.ReactElement {
  return (
    <div className={cx('alert', `a-${tone}`)} role={tone === 'err' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICON[tone]} />
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
      </div>
      {onDismiss && (
        <button type="button" className="close" onClick={onDismiss} aria-label={`Dismiss: ${title}`}>
          <Icon name="x" size="sm" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Empty and loading states                                                   */
/* ------------------------------------------------------------------------ */

/**
 * An empty state names what will appear and gives the one action that fills
 * it. Never a blank area, never a bare spinner.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="empty">
      <Icon name={icon} size="xl" />
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** A skeleton mirrors the shape of what is coming, so nothing jumps on load. */
export function Skeleton({
  width,
  height = 9,
  radius,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cx('skel', className)}
      style={{
        display: 'block',
        width: typeof width === 'number' ? `${width}px` : (width ?? '100%'),
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
      }}
      aria-hidden="true"
    />
  );
}

/** Row skeletons shaped like the table that is loading. */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }): React.ReactElement {
  return (
    <div className="tablewrap" aria-hidden="true">
      <div className="tablescroll">
        <table className="dt">
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: columns }, (_, c) => (
                  <td key={c}>
                    <Skeleton width={c === 0 ? 120 : 68} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Wraps a region that is loading, failed or empty so every screen handles the
 * three the same way and none of them ships a blank area.
 */
export function AsyncRegion({
  loading,
  error,
  isEmpty,
  empty,
  skeleton,
  onRetry,
  children,
}: {
  loading: boolean;
  error: Error | null;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  skeleton?: React.ReactNode;
  onRetry?: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  if (loading) {
    return (
      <>
        <span className="sr-only" role="status">
          Loading
        </span>
        {skeleton ?? <TableSkeleton />}
      </>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon="breach"
        title="That did not load"
        action={
          onRetry && (
            <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      >
        {error.message}
      </EmptyState>
    );
  }
  if (isEmpty && empty) return <>{empty}</>;
  return <>{children}</>;
}

/* ------------------------------------------------------------------------ */
/* Toasts — confirm something that already happened, then leave               */
/* ------------------------------------------------------------------------ */

type ToastTone = 'ok' | 'err' | 'warn' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastApi {
  toast: (tone: ToastTone, title: string, message?: string) => void;
  ok: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_ICON: Record<ToastTone, IconName> = {
  ok: 'check-circle',
  err: 'x-circle',
  warn: 'alert',
  info: 'info',
};
let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((tone: ToastTone, title: string, message?: string) => {
    const id = nextId++;
    // Three at a time, oldest dropped — per design system section 31.
    setItems((current) => [...current.slice(-2), { id, tone, title, message }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast: push,
      ok: (title, message) => push('ok', title, message),
      error: (title, message) => push('err', title, message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      <Toast.Provider duration={4000} swipeDirection="right">
        {children}
        {items.map((item) => (
          <Toast.Root
            key={item.id}
            className={cx('toast', item.tone)}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((t) => t.id !== item.id));
            }}
          >
            {/* The icon and the drain bar take their colour from the design
                system's own `.toast.ok .ic` / `.bar` rules — nothing here. */}
            <Icon name={TOAST_ICON[item.tone]} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Toast.Title asChild>
                <b>{item.title}</b>
              </Toast.Title>
              {item.message && (
                <Toast.Description asChild>
                  <p>{item.message}</p>
                </Toast.Description>
              )}
            </div>
            <Toast.Close className="close" aria-label="Dismiss">
              <Icon name="x" size="sm" />
            </Toast.Close>
            <span className="bar" aria-hidden="true" />
          </Toast.Root>
        ))}
        <Toast.Viewport className="toastwrap" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
